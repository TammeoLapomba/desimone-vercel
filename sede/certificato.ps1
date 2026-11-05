# sede/certificato.ps1 - Il certificato "di casa" per l'HTTPS della sede (architettura-locale 4), senza internet
#
# Lo lancia installa.js con --https si; si puo' rilanciare quante volte si vuole:
#   - l'autorita' di casa (CA) si crea una volta sola e dura 10 anni: e' il file da installare una volta su ogni
#     tablet (<dati>\certificati\ca-desimone.crt, anche su http://<PC>:8080/certificato);
#   - il certificato del server si rifa' quando manca, quando scade entro 30 giorni o quando il PC ha un indirizzo
#     della rete che il certificato non contiene. I tablet non devono fare niente: si fidano gia' della CA.
# La chiave della CA resta in <dati>\segreti\ca-desimone.pfx. Password dei due file .pfx: variabile d'ambiente
# DESIMONE_CERTIFICATI (installa.js la prende da segreti\certificati-password).
# Usa New-SelfSignedCertificate di Windows, nel magazzino dei certificati dell'utente (non serve l'amministratore);
# alla fine li toglie dal magazzino: restano solo i file.
param([Parameter(Mandatory = $true)][string]$Dati,
      [string[]]$Nomi = @())

$ErrorActionPreference = 'Stop'
$Password = $env:DESIMONE_CERTIFICATI
if (-not $Password) { throw 'Manca la variabile DESIMONE_CERTIFICATI con la password dei certificati' }
$Segreta = ConvertTo-SecureString -String $Password -AsPlainText -Force
$Cartella = Join-Path $Dati 'certificati'
$CaPfx = Join-Path $Dati 'segreti\ca-desimone.pfx'
$CaCrt = Join-Path $Cartella 'ca-desimone.crt'
$ServerPfx = Join-Path $Cartella 'server.pfx'
$Magazzino = 'Cert:\CurrentUser\My'
New-Item -ItemType Directory -Force $Cartella, (Split-Path $CaPfx) | Out-Null

# Nomi e indirizzi del server: quelli fissi, il nome del PC e tutti gli indirizzi privati che ha adesso. 192.168.137.1
# e' l'indirizzo che Windows da' sempre al PC quando accende l'hotspot mobile: c'e' anche a hotspot spento
$Dns = @('gestionale.desimone.lan', 'localhost', $env:COMPUTERNAME.ToLower()) + $Nomi | Select-Object -Unique
$Ip = @('127.0.0.1', '192.168.137.1') + @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object IPAddress |
  Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' }) | Select-Object -Unique

function Togli($cert) { if ($cert) { Remove-Item (Join-Path $Magazzino $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue } }
function Leggi($file) {
  New-Object Security.Cryptography.X509Certificates.X509Certificate2($file, $Password,
    [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
}

$ca = $null; $server = $null
try {
  # 1. L'autorita' di casa
  $nuovaCa = -not (Test-Path $CaPfx)
  if ($nuovaCa) {
    $ca = New-SelfSignedCertificate -Type Custom -Subject 'CN=De Simone - autorita di casa, O=De Simone' `
      -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
      -KeyUsage CertSign, CRLSign, DigitalSignature -KeyUsageProperty Sign `
      -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0') `
      -NotAfter (Get-Date).AddYears(10) -CertStoreLocation $Magazzino
    Export-PfxCertificate -Cert $ca -FilePath $CaPfx -Password $Segreta | Out-Null
    Export-Certificate -Cert $ca -FilePath $CaCrt -Type CERT | Out-Null
    'autorita di casa creata: da installare su ogni tablet (una volta sola)'
  } else {
    $ca = Import-PfxCertificate -FilePath $CaPfx -Password $Segreta -CertStoreLocation $Magazzino
    if (-not (Test-Path $CaCrt)) { Export-Certificate -Cert $ca -FilePath $CaCrt -Type CERT | Out-Null }
    'autorita di casa gia presente (scade il ' + $ca.NotAfter.ToString('dd/MM/yyyy') + ')'
  }
  $impronta = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($ca.RawData)).Replace('-', ':')
  "impronta SHA-256 dell'autorita: $impronta"

  # 2. Il certificato del server: si rifa' solo se serve
  $motivo = $null
  if ($nuovaCa -or -not (Test-Path $ServerPfx)) { $motivo = 'nuovo' }
  else {
    $c = Leggi $ServerPfx
    $san = ($c.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' }).Format($false)
    $mancano = @($Ip | Where-Object { $san -notmatch "(?<![\d.])$([regex]::Escape($_))(?![\d.])" }) +
               @($Dns | Where-Object { $san -notmatch "(?<![\w.-])$([regex]::Escape($_))(?![\w.-])" })
    if ($c.Issuer -ne $ca.Subject) { $motivo = "firmato da un'altra autorita" }
    elseif ($c.NotAfter -lt (Get-Date).AddDays(30)) { $motivo = 'scade il ' + $c.NotAfter.ToString('dd/MM/yyyy') }
    elseif ($mancano) { $motivo = 'mancano ' + ($mancano -join ', ') }
    else { 'certificato del server valido fino al ' + $c.NotAfter.ToString('dd/MM/yyyy') + ' per ' + (($Dns + $Ip) -join ', ') }
    $c.Dispose()
  }
  if ($motivo) {
    $san = (@($Dns | ForEach-Object { "DNS=$_" }) + @($Ip | ForEach-Object { "IPAddress=$_" })) -join '&'
    # 825 giorni: il massimo che accettano tutti i browser anche per un'autorita privata
    $server = New-SelfSignedCertificate -Type Custom -Subject 'CN=gestionale.desimone.lan, O=De Simone' -Signer $ca `
      -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
      -KeyUsage DigitalSignature, KeyEncipherment `
      -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1', '2.5.29.19={text}ca=0') `
      -NotAfter (Get-Date).AddDays(825) -CertStoreLocation $Magazzino
    Export-PfxCertificate -Cert $server -FilePath $ServerPfx -Password $Segreta -ChainOption EndEntityCertOnly | Out-Null
    "certificato del server rifatto ($motivo): valido fino al " + $server.NotAfter.ToString('dd/MM/yyyy') + ' per ' + (($Dns + $Ip) -join ', ')
    'RIAVVIA il servizio della sede perche lo usi'
  }
} finally {
  Togli $server
  Togli $ca
}
