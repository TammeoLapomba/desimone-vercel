# mov_run.ps1 - Banco del registro dei movimenti sul modello vero (REQ-I-06, REQ-N-01), su Windows.
# Stesse prove di mov_run.sh: crea il database $Db (desimone_bench) con le migrazioni della sede, lo riempie con
# mov_gen.sql e misura con pgbench, con ruolo e token come in PostgREST. Il database della sede ("desimone") non
# si tocca: lo script si rifiuta di usarlo e non cambia ruoli ne' password.
#
# Uso, da PowerShell nella cartella di questo file:
#   $env:PGPASSWORD = "password dell'utente postgres"
#   .\mov_run.ps1 -N 10000 -M 100
param([int]$N = 10000, [int]$M = 100, [string]$Db = "desimone_bench", [string]$PgHost = "localhost",
      [int]$Port = 5432, [string]$User = "postgres", [string]$PgBin = "")

# "Continue": psql e pgbench scrivono avvisi su stderr, che con "Stop" PowerShell 5.1 tratterebbe come errori
$ErrorActionPreference = "Continue"
if ($Db -eq "desimone") { throw "Il database della sede non si usa per le prove: scegli un altro -Db" }
if (-not $PgBin) {
  foreach ($v in "17", "16") { if (Test-Path "C:\Program Files\PostgreSQL\$v\bin\psql.exe") { $PgBin = "C:\Program Files\PostgreSQL\$v\bin"; break } }
}
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$D = Join-Path $PSScriptRoot "pgbench"
$Log = Join-Path $env:TEMP ("mov_bench_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Log | Out-Null
$env:PGCLIENTENCODING = "UTF8"
$env:PGOPTIONS = "-c client_min_messages=warning"
$conn = @("-h", $PgHost, "-p", $Port, "-U", $User)

function Psql {
  $out = & (Join-Path $PgBin "psql.exe") -X -q -v ON_ERROR_STOP=1 @conn @args
  if ($LASTEXITCODE -ne 0) { throw "psql si e' fermato con un errore (vedi sopra)" }
  $out
}

"== Database ${Db}: migrazioni della sede"
Psql -d postgres -c "DROP DATABASE IF EXISTS $Db" -c "CREATE DATABASE $Db ENCODING 'UTF8' TEMPLATE template0" | Out-Null
$files = @(Get-ChildItem (Join-Path $Repo "sede\database\00_*.sql")) +
         @(Get-ChildItem (Join-Path $Repo "supabase\migrations\0*.sql") | Where-Object { $_.Name -notlike "008_*" } | Sort-Object Name) +
         @(Get-ChildItem (Join-Path $Repo "sede\database\9*.sql") | Sort-Object Name)
foreach ($f in $files) { Psql -d $Db -f $f.FullName | Out-Null }
"   ultima migrazione: " + ($files | Where-Object { $_.DirectoryName -like "*migrations" } | Select-Object -Last 1).Name

"== Dati: $N gioielli, $M movimenti ciascuno"
Psql -d $Db -v N=$N -v M=$M -f (Join-Path $PSScriptRoot "mov_gen.sql") | Select-String "gioielli|^ +[0-9]+ \|"

$Pagine = [int](Psql -d $Db -tAc "SELECT greatest(1, ceil(count(*) / 1000.0))::int FROM stock_levels")
$Prezzo = (Psql -d $Db -tAc "SELECT vendita_con_prezzo FROM bench.conf") -eq "t"
$Vendita = if ($Prezzo) { "mov_vendita_prezzo" } else { "mov_vendita" }

# Percentili dal registro di pgbench (tempo in microsecondi nella terza colonna, script nella quarta)
function Percentili($lines, $script) {
  $v = @($lines | ForEach-Object { $c = $_ -split " "; if ($c[3] -eq "$script") { [double]$c[2] / 1000 } } | Sort-Object)
  if (-not $v.Count) { return "" }
  "p50={0:N1} p95={1:N1} max={2:N1} ms" -f $v[[int][math]::Floor($v.Count * 0.5)], $v[[math]::Min($v.Count - 1, [int][math]::Floor($v.Count * 0.95))], $v[-1]
}

function Bench($scripts, $secs, $clients, $threads) {
  Remove-Item (Join-Path $Log "pgbench_log*") -ErrorAction SilentlyContinue
  $args2 = @("-n", "-M", "prepared", "-D", "N=$N", "-D", "PAGINE=$Pagine") + $scripts +
           @("-T", $secs, "-c", $clients, "-j", $threads, "--log", "--log-prefix=$(Join-Path $Log 'pgbench_log')", $Db)
  $out = & (Join-Path $PgBin "pgbench.exe") @conn @args2 2>&1 | Out-String
  # Un client che riceve un errore (per esempio una giacenza finita) si ferma: lo si dice, e le prove vanno avanti
  $out -split "`n" | Select-String "aborted|ERROR" | Select-Object -First 2 | ForEach-Object { "   ATTENZIONE: $_" } | Write-Host
  $lines = Get-Content (Join-Path $Log "pgbench_log*")
  @{ out = $out; lines = $lines }
}

function Run($name, $secs) {
  $r = Bench @("-f", (Join-Path $D "$name.sql")) $secs 1 1
  $lat = ([regex]::Match($r.out, "(?m)^latency average = ([\d.]+)")).Groups[1].Value
  $tps = ([regex]::Match($r.out, "(?m)^tps = ([\d.]+)")).Groups[1].Value
  "{0,-20} c=1  lat_ms={1,-8} tps={2,-8} {3}" -f $name, $lat, $tps, (Percentili $r.lines 0)
}

"== Un operatore alla volta"
Run "mov_giacenza" 10
Run "mov_storico" 10
Run $Vendita 10
Run "mov_trasferimento" 10
Run "mov_articoli" 20
Run "mov_giacenze_pagina" 20
"   la schermata Giacenze legge $Pagine pagine una dopo l'altra: circa $Pagine volte mov_giacenze_pagina"
Run "mov_giacenze_tutte" 20

function Mix($title, $pairs) {
  $scripts = @(); $names = @()
  foreach ($p in $pairs) { $s = $p.Split("@"); $scripts += @("-f", (Join-Path $D "$($s[0]).sql@$($s[1])")); $names += $s[0] }
  $r = Bench $scripts 30 10 4
  "== 10 operatori insieme (REQ-N-01), 30 s: $title"
  "   tempo medio: " + ([regex]::Match($r.out, "(?m)^latency average = ([\d.]+)")).Groups[1].Value + " ms"
  "   in tutto: " + ([regex]::Match($r.out, "(?m)^tps = ([\d.]+)")).Groups[1].Value + " operazioni/s"
  for ($i = 0; $i -lt $names.Count; $i++) { "   {0,-20} {1}" -f $names[$i], (Percentili $r.lines $i) }
}
Mix "registrazioni" @("mov_giacenza@35", "mov_storico@25", "$Vendita@25", "mov_trasferimento@15")
Mix "registrazioni e schermate pesanti" @("mov_giacenza@33", "mov_storico@24", "$Vendita@24", "mov_trasferimento@15",
                                          "mov_articoli@2", "mov_giacenze_pagina@2")

"== Alla fine: " + (Psql -d $Db -tAc "SELECT count(*) || ' movimenti, database di ' || pg_size_pretty(pg_database_size(current_database())) FROM movements")
"Per cancellare il database delle prove: psql -U postgres -d postgres -c `"DROP DATABASE $Db`""
Remove-Item -Recurse -Force $Log
