# sede/prove/sede-locale.ps1 - La sede installata sul PC di chi prova, al posto della Windows Sandbox
#
# La Sandbox andava in crash (schermata blu 0x3B, 03-04/11/2026): le prove delle PR si fanno qui. Stessi programmi
# della sede (sede/README.md), dalla cartella di questo repository: PostgreSQL 17 (estratto dall'installer, senza
# servizio di Windows, porta 5432, messaggi in italiano), PostgREST, servizio della sede (Node) e installa.js.
# L'app: http://localhost:8080. Rispetto alla sede vera mancano i servizi di Windows (WinSW), il limite di 4 GB
# e il PC senza internet: le PR che li toccano vanno provate sul mini PC.
#
#   sede-locale.ps1 installa            sede nuova dal branch aperto nel repository
#   sede-locale.ps1 installa -Azzera    cancella la sede che c'e' e la rifa da capo
#   sede-locale.ps1 aggiorna            solo le migrazioni nuove e riavvio del servizio della sede (L-14)
#   sede-locale.ps1 avvia | ferma       dopo un riavvio del PC, o quando non serve
#   sede-locale.ps1 stato               cosa e' acceso e quale branch serve
#   sede-locale.ps1 dati [-Pallino]     dati di prova (dati-prova.ps1)
#   -Rete si | no                       con installa o aggiorna: l'app anche dai tablet della rete locale, oppure
#                                       solo da qui (resta per i giri successivi). Il firewall lo apre sede\rete.ps1
#   -Https si | no                      con installa o aggiorna: HTTPS col certificato di casa (sede\certificato.ps1)
#
# Windows blocca gli script: si lanciano con powershell -ExecutionPolicy Bypass -File sede\prove\sede-locale.ps1 ...
#
# Serve, fuori dal repository:
#   - nella cartella degli installer (-Installer): l'installer di PostgreSQL 17 per Windows (EDB) e lo ZIP di
#     PostgREST per Windows, gli stessi del passo 0 di sede/README.md; Node.js 22 installato;
#   - un file di credenziali (-Credenziali, mai nel repository), con quattro righe:
#       PostgresPassword=...   AdminNome=...   AdminEmail=...   AdminPassword=...
# Tutto il resto (PostgreSQL, dati, foto, log) va nella cartella della sede (-Cartella).
param([ValidateSet('installa', 'aggiorna', 'avvia', 'ferma', 'stato', 'dati')][string]$Comando = 'stato',
      [switch]$Azzera,
      [switch]$Pallino,
      [ValidateSet('', 'si', 'no')][string]$Rete = '',
      [ValidateSet('', 'si', 'no')][string]$Https = '',
      [string]$Cartella = (Join-Path $env:USERPROFILE 'DeSimoneSede'),
      [string]$Installer = (Join-Path $env:USERPROFILE 'DeSimoneSandbox\installer'),
      [string]$Credenziali = '')

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Home_ = $Cartella
$Pg = Join-Path $Home_ 'pg'
$PgData = Join-Path $Home_ 'pgdata'
$Dati = Join-Path $Home_ 'dati'
$Log = Join-Path $Home_ 'log'
$Esito = Join-Path $Home_ 'esito'
if (-not $Credenziali) { $Credenziali = Join-Path $Home_ 'credenziali.txt' }
$Node = 'C:\Program Files\nodejs\node.exe'
$NodeSede = Join-Path $Dati 'bin\node-sede.exe'   # il Node.js del servizio, copiato da installa.js (firewall: sede\rete.ps1)
if (-not (Test-Path $Credenziali)) {
  throw "Manca $Credenziali, con le righe PostgresPassword=..., AdminNome=..., AdminEmail=..., AdminPassword=..."
}
$cred = Get-Content $Credenziali | ConvertFrom-StringData
$env:PGPASSWORD = $cred.PostgresPassword
# PostgREST e il servizio ereditano le variabili di questa finestra: un PGOPTIONS rimasto (per esempio da run.ps1)
# con lc_messages impedirebbe a PostgREST di collegarsi ("permesso di impostare il parametro lc_messages negato")
Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue
$env:PATH = "$Pg\bin;$env:PATH"   # postgrest.exe usa LIBPQ.dll di PostgreSQL, come in servizio-postgrest.xml
New-Item -ItemType Directory -Force $Log, $Esito | Out-Null

function Passo($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
# I processi di questa sede: quelli che nella riga di comando hanno la sua cartella
function Processi($nome) {
  @(Get-CimInstance Win32_Process -Filter "Name = '$nome'" | Where-Object { $_.CommandLine -like "*$Home_*" })
}
# pg_ctl lascia aperte le uscite del server: si aspetta solo pg_ctl, non i processi che avvia
function PgCtl([string[]]$argomenti) {
  $p = Start-Process "$Pg\bin\pg_ctl.exe" -ArgumentList $argomenti -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$Log\pg_ctl.out" -RedirectStandardError "$Log\pg_ctl.err"
  $null = $p.Handle   # senza, in PowerShell 5.1 ExitCode resta vuoto
  $p.WaitForExit()
  $p.ExitCode
}
function PgAcceso { (Test-Path $PgData) -and (PgCtl @('status', '-D', "`"$PgData`"")) -eq 0 }
$PgOpzioni = '"-p 5432 -c listen_addresses=localhost"'

function AvviaPg {
  if (PgAcceso) { 'PostgreSQL gia'' acceso'; return }
  $c = PgCtl @('start', '-w', '-D', "`"$PgData`"", '-l', "`"$Log\postgres.log`"", '-o', $PgOpzioni)
  if ($c -ne 0) { throw "PostgreSQL non parte: guarda $Log\postgres.log" }
  'PostgreSQL acceso sulla porta 5432'
}
function AvviaPostgrest {
  if (@(Processi 'postgrest.exe').Count) { 'PostgREST gia'' acceso'; return }
  Start-Process "$Dati\bin\postgrest.exe" -ArgumentList "`"$Dati\postgrest.conf`"" -WindowStyle Hidden `
    -RedirectStandardOutput "$Log\postgrest.log" -RedirectStandardError "$Log\postgrest.err" | Out-Null
  'PostgREST acceso sulla porta 3000'
}
# Il servizio gira con node-sede.exe; una sede installata prima di questa versione lo aveva avviato con node.exe
function ProcessiServizio { @(Processi 'node-sede.exe') + @(Processi 'node.exe') }
function AvviaServizio {
  if (@(ProcessiServizio).Count) { 'servizio della sede gia'' acceso'; return }
  Start-Process $NodeSede -ArgumentList "`"$Repo\sede\servizio\servizio.js`"", "`"$Dati\sede.json`"" -WindowStyle Hidden `
    -RedirectStandardOutput "$Log\servizio.log" -RedirectStandardError "$Log\servizio.err" | Out-Null
  'servizio della sede acceso sulla porta 8080'
}
function FermaServizio { ProcessiServizio | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'servizio della sede spento' }
function Salute {
  for ($i = 0; $i -lt 20; $i++) {
    # Il servizio ascolta su 127.0.0.1; la prima richiesta di PowerShell puo' metterci qualche secondo
    try { $s = Invoke-RestMethod http://127.0.0.1:8080/salute -TimeoutSec 15; "salute: $($s.servizio)"; return } catch { Start-Sleep 1 }
  }
  throw "Il servizio della sede non risponde: guarda $Log\servizio.err"
}
function Ferma {
  FermaServizio
  Processi 'postgrest.exe' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'PostgREST spento'
  if (PgAcceso) { PgCtl @('stop', '-m', 'fast', '-D', "`"$PgData`"") | Out-Null }; 'PostgreSQL spento'
}
# installa.js dal branch aperto: crea o aggiorna il database; le risposte servono solo la prima volta
function Installa {
  Push-Location $Repo
  try {
    $opzioni = @('--dati', $Dati, '--psql', "$Pg\bin\psql.exe")
    if ($Rete) { $opzioni += @('--rete', $Rete) }
    if ($Https) { $opzioni += @('--https', $Https) }
    "$($cred.AdminNome)`n$($cred.AdminEmail)`n$($cred.AdminPassword)`n" |
      & $Node sede\installa.js @opzioni
    if ($LASTEXITCODE -ne 0) { throw "installa.js: codice $LASTEXITCODE" }
  } finally { Pop-Location }
}
function Branch { (& git -C $Repo rev-parse --abbrev-ref HEAD) + ' ' + (& git -C $Repo log --oneline -1) }
function DaInstaller($filtro) {
  $f = Get-ChildItem $Installer -Filter $filtro -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
  if (-not $f) { throw "Manca $filtro in $Installer (passo 0 di sede/README.md)" }
  $f.FullName
}

switch ($Comando) {
  'installa' {
    if (Test-Path $PgData) {
      if (-not $Azzera) { throw "C'e' gia' una sede in $Home_. Per rifarla da capo: sede-locale.ps1 installa -Azzera" }
      Passo 'Cancello la sede che c''e'''
      Ferma
      Remove-Item $PgData, $Dati -Recurse -Force -ErrorAction SilentlyContinue
    }
    Passo "Repository: $(Branch)"

    Passo 'PostgreSQL 17'
    if (Test-Path "$Pg\bin\psql.exe") { 'gia'' estratto' } else {
      $p = Start-Process (DaInstaller 'postgresql-17*-windows-x64.exe') -Wait -PassThru -ArgumentList @(
        '--mode', 'unattended', '--unattendedmodeui', 'none', '--extract-only', '1', '--prefix', "`"$Pg`"")
      if ($p.ExitCode -ne 0) { throw "installer PostgreSQL: codice $($p.ExitCode)" }
      Remove-Item "$Pg\pgAdmin 4", "$Pg\stackbuilder", "$Pg\doc" -Recurse -Force -ErrorAction SilentlyContinue
      'estratto'
    }
    # Come l'installer della sede: password per postgres, UTF-8, messaggi in italiano
    $pw = Join-Path $Home_ 'pw.tmp'
    [IO.File]::WriteAllText($pw, $cred.PostgresPassword)
    try {
      & "$Pg\bin\initdb.exe" -D $PgData -U postgres -A scram-sha-256 --pwfile=$pw -E UTF8 --locale=Italian_Italy.1252 *> "$Log\initdb.log"
      if ($LASTEXITCODE -ne 0) { throw "initdb: guarda $Log\initdb.log" }
    } finally { Remove-Item $pw -Force }
    AvviaPg

    Passo 'PostgREST'
    if (-not (Test-Path "$Dati\bin\postgrest.exe")) {
      New-Item -ItemType Directory -Force "$Dati\bin" | Out-Null
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [IO.Compression.ZipFile]::OpenRead((DaInstaller 'postgrest-*-windows-*.zip'))
      try { [IO.Compression.ZipFileExtensions]::ExtractToFile(($zip.Entries | Where-Object Name -eq 'postgrest.exe'), "$Dati\bin\postgrest.exe") }
      finally { $zip.Dispose() }
    }
    'pronto'

    Passo 'installa.js'
    Installa

    Passo 'Riavvio di PostgreSQL (impostazioni per 4 GB) e servizi'
    PgCtl @('restart', '-w', '-D', "`"$PgData`"", '-l', "`"$Log\postgres.log`"", '-o', $PgOpzioni) | Out-Null
    AvviaPostgrest
    AvviaServizio
    Salute
    Write-Host "`nFatto: http://localhost:8080, con $($cred.AdminEmail)" -ForegroundColor Green
  }
  'aggiorna' {
    Passo "Repository: $(Branch)"
    Passo 'installa.js (solo migrazioni nuove)'
    AvviaPg
    Installa
    Passo 'Riavvio del servizio della sede'
    # Come L-14: PostgREST non si riavvia, deve rileggere lo schema da solo con il NOTIFY delle migrazioni
    FermaServizio
    AvviaServizio
    Salute
    Write-Host 'Fatto. In Edge ricarica con Ctrl + Shift + R.' -ForegroundColor Green
  }
  'avvia' { AvviaPg; AvviaPostgrest; AvviaServizio; Salute }
  'ferma' { Ferma }
  'stato' {
    "Repository: $(Branch)"
    "Cartella della sede: $Home_"
    'PostgreSQL: ' + $(if (PgAcceso) { 'acceso' } else { 'spento' })
    'PostgREST: ' + $(if (@(Processi 'postgrest.exe').Count) { 'acceso' } else { 'spento' })
    'Servizio della sede: ' + $(if (@(ProcessiServizio).Count) { 'acceso' } else { 'spento' })
    if (Test-Path "$Dati\sede.json") {
      $sede = Get-Content "$Dati\sede.json" -Raw | ConvertFrom-Json
      'Dalla rete locale: ' + $(if ($sede.indirizzo -eq '0.0.0.0') { 'si (firewall: sede\rete.ps1 stato)' } else { 'no, solo da questo PC' })
      'HTTPS: ' + $(if ($sede.https) { "si, porta $($sede.https.porta) (certificato per i tablet: /certificato)" } else { 'no' })
    }
  }
  'dati' {
    & (Join-Path $PSScriptRoot 'dati-prova.ps1') -Credenziali $Credenziali -Esito $Esito -Foto "$Dati\foto" -Psql "$Pg\bin\psql.exe" -Pallino:$Pallino
  }
}
