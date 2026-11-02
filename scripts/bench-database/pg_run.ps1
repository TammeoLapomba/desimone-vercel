# Banco PostgreSQL per il PC server (Windows). Stesse prove di pg_run.sh.
# Uso, da PowerShell nella cartella di questo file:
#   .\pg_run.ps1 -Db a3m -N 3000000
# Richiede pgbench e psql nel PATH (C:\Program Files\PostgreSQL\<versione>\bin).
param([string]$Db = "a3m", [int]$N = 3000000, [string]$PgHost = "localhost", [int]$Port = 5432, [string]$User = "postgres")
$D = Join-Path $PSScriptRoot "pgbench"
$common = @("-h", $PgHost, "-p", $Port, "-U", $User, "-n", "-D", "N=$N")

function Run($name, $secs, $clients) {
  $out = & pgbench @common -f (Join-Path $D "$name.sql") -T $secs -c $clients -j $clients $Db 2>&1 | Out-String
  $lat = ([regex]::Match($out, "latency average = ([\d.]+)")).Groups[1].Value
  $tps = ([regex]::Match($out, "tps = ([\d.]+)")).Groups[1].Value
  "{0,-8} c={1,-2} lat_ms={2,-9} tps={3}" -f $name, $clients, $lat, $tps
}

foreach ($q in "sku", "list", "mov", "rare", "count") { Run $q 10 1 }
Run "common" 20 1
Run "report" 20 1
foreach ($q in "sale", "edit", "ins") { Run $q 10 1 }

"-- concorrenza: 8 utenti, mix realistico"
$mix = @("sku@45", "list@15", "rare@10", "mov@10", "sale@15", "ins@5") | ForEach-Object { "-f"; (Join-Path $D $_.Split("@")[0]) + ".sql@" + $_.Split("@")[1] }
& pgbench @common @mix -T 30 -c 8 -j 4 $Db 2>&1 | Select-String "latency average|^tps"
