# sede/rete.ps1 - Il gestionale dalla rete locale, mai da internet: le regole del firewall di Windows
#
# Si lancia in PowerShell come amministratore, dopo installa.js (che copia Node.js in <dati>\bin\node-sede.exe):
#   powershell -ExecutionPolicy Bypass -File sede\rete.ps1 apri   [-Dati C:\DeSimone\dati]
#   powershell -ExecutionPolicy Bypass -File sede\rete.ps1 stato  [-Dati ...]
#   powershell -ExecutionPolicy Bypass -File sede\rete.ps1 chiudi [-Dati ...]
#
# apri (si puo' rilanciare: rifa' le regole da capo, per esempio dopo aver cambiato porta)
#   - in entrata la porta dell'app (sede.json: 8080, e quella HTTPS se c'e'), solo per node-sede.exe, solo dalla
#     sottorete del PC (LocalSubnet) e solo su una rete Privata o di Dominio: su una rete Pubblica nessuno entra;
#   - per node-sede.exe, postgrest.exe e i programmi di PostgreSQL, in uscita e in entrata, bloccati tutti gli
#     indirizzi di internet (tutto tranne il PC stesso e gli indirizzi privati della rete). In Windows un blocco vale
#     piu' di un permesso: vale anche sopra regole messe da altri (l'installer di PostgreSQL, un "Consenti" cliccato).
# chiudi: toglie tutte le regole del gruppo "De Simone gestionale". Per tornare solo a questo PC anche nel servizio:
#   node sede\installa.js --dati ... --rete no, poi riavvio del servizio della sede.
#
# Il servizio della sede fa gli stessi controlli da solo (servizio.js): chiude le connessioni che non vengono dalla
# rete locale e non si collega a niente fuori da questo PC. Il firewall e' la seconda barriera.
param([ValidateSet('apri', 'chiudi', 'stato')][string]$Comando = 'stato',
      [string]$Dati = 'C:\DeSimone\dati')

$ErrorActionPreference = 'Stop'
$Gruppo = 'De Simone gestionale'
$SedeJson = Join-Path $Dati 'sede.json'
if (-not (Test-Path $SedeJson)) { throw "Manca $SedeJson. Prima: node sede\installa.js --dati $Dati" }
$sede = Get-Content $SedeJson -Raw | ConvertFrom-Json
$Porte = @([string]$sede.porta)
if ($sede.https) { $Porte += [string]$(if ($sede.https.porta) { $sede.https.porta } else { 443 }) }
$NodeSede = Join-Path $Dati 'bin\node-sede.exe'
$Programmi = @($NodeSede, (Join-Path $Dati 'bin\postgrest.exe'))
if ($sede.pgBin) { $Programmi += @('postgres.exe', 'pg_dump.exe', 'pg_restore.exe' | ForEach-Object { Join-Path $sede.pgBin $_ }) }
# Internet: tutti gli indirizzi tranne 0/8, 10/8, 127/8 (il PC stesso), 169.254/16, 172.16/12, 192.168/16 e da 224 in
# su (multicast); per IPv6 tutti gli indirizzi pubblici (2000::/3)
$Internet = @('1.0.0.0-9.255.255.255', '11.0.0.0-126.255.255.255', '128.0.0.0-169.253.255.255',
              '169.255.0.0-172.15.255.255', '172.32.0.0-192.167.255.255', '192.169.0.0-223.255.255.255', '2000::/3')

function Amministratore {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Regole { @(Get-NetFirewallRule -Group $Gruppo -ErrorAction SilentlyContinue) }
function Togli { Regole | Remove-NetFirewallRule; 'regole tolte' }
function Reti {
  foreach ($r in @(Get-NetConnectionProfile)) {
    $tipo = switch ([string]$r.NetworkCategory) { 'Private' { 'Privata' } 'DomainAuthenticated' { 'di Dominio' } default { 'Pubblica' } }
    $riga = "  $($r.InterfaceAlias) ($($r.Name)): rete $tipo"
    if ($tipo -eq 'Pubblica') {
      $riga += ' -> da qui non entra nessuno. Se e'' la rete dell''azienda: Impostazioni > Rete e Internet > ' +
               'Wi-Fi o Ethernet > questa rete > Tipo di profilo di rete: Privato'
    }
    $riga
  }
}
function Indirizzi {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object {
      if ($sede.https) {
        "  https://$($_.IPAddress):$($Porte[1])   ($($_.InterfaceAlias); la prima volta http://$($_.IPAddress):$($sede.porta)/certificato)"
      } else { "  http://$($_.IPAddress):$($sede.porta)   ($($_.InterfaceAlias))" }
    }
}

switch ($Comando) {
  'apri' {
    if (-not (Amministratore)) { throw 'Serve PowerShell come amministratore (tasto destro > Esegui come amministratore)' }
    if (Regole) { Togli | Out-Null }
    $comune = @{ Group = $Gruppo; ErrorAction = 'Stop' }
    New-NetFirewallRule @comune -DisplayName "De Simone - app dalla rete locale (TCP $($Porte -join ', '))" `
      -Direction Inbound -Action Allow -Program $NodeSede -Protocol TCP -LocalPort $Porte `
      -RemoteAddress LocalSubnet -Profile Domain, Private | Out-Null
    foreach ($p in $Programmi) {
      $nome = Split-Path $p -Leaf
      New-NetFirewallRule @comune -DisplayName "De Simone - niente internet in uscita: $nome" `
        -Direction Outbound -Action Block -Program $p -RemoteAddress $Internet -Profile Any | Out-Null
      New-NetFirewallRule @comune -DisplayName "De Simone - niente internet in entrata: $nome" `
        -Direction Inbound -Action Block -Program $p -RemoteAddress $Internet -Profile Any | Out-Null
    }
    "regole del firewall: $(@(Regole).Count) (gruppo `"$Gruppo`")"
    if (-not (Test-Path $NodeSede)) { "ATTENZIONE: manca $NodeSede. Rilancia installa.js, che lo copia" }
    if ($sede.indirizzo -ne '0.0.0.0') {
      'ATTENZIONE: il servizio ascolta ancora solo su questo PC. Rilancia installa.js con --rete si e riavvia il servizio'
    }
    'Reti di questo PC:'; Reti
    'Dai tablet, sulla stessa rete:'; Indirizzi
  }
  'chiudi' {
    if (-not (Amministratore)) { throw 'Serve PowerShell come amministratore (tasto destro > Esegui come amministratore)' }
    Togli
  }
  'stato' {
    $regole = Regole
    if ($regole) { $regole | Sort-Object Direction, DisplayName | Format-Table DisplayName, Enabled, Direction, Action -AutoSize | Out-String }
    else { "Nessuna regola del gruppo `"$Gruppo`": firewall non aperto (sede\rete.ps1 apri, da amministratore)" }
    'Servizio della sede: ' + $(if ($sede.indirizzo -eq '0.0.0.0') { 'anche dalla rete locale' } else { 'solo da questo PC (installa.js --rete si)' })
    $ascolta = @(Get-NetTCPConnection -LocalPort $sede.porta -State Listen -ErrorAction SilentlyContinue)
    'In ascolto sulla porta ' + $sede.porta + ': ' + $(if ($ascolta) { ($ascolta.LocalAddress | Sort-Object -Unique) -join ', ' } else { 'niente (servizio spento?)' })
    'Reti di questo PC:'; Reti
    'Dai tablet, sulla stessa rete:'; Indirizzi
  }
}
