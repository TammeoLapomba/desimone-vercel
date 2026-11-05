# sede/prove/dati-prova.ps1 - Dati di prova in una sede appena installata (sede-locale.ps1 installa)
#
# Passa dalle stesse richieste dell'app (accesso, /rest/v1, /foto), quindi la foto finisce davvero nella cartella
# delle foto della sede. Alla fine scrive i codici da annotare, anche in <Esito>\dati-prova.txt:
#   - collezione Prova (PRV);
#   - Anello Usato: primo materiale e primo metallo, prezzo 100, peso 5, carico di 2 pezzi in Laboratorio dal
#     dispositivo PC1 (nell'app scegli PC1 in "Usa questo dispositivo");
#   - Anello Nuovo: secondo materiale, stesso metallo, prezzo 100, peso 5, una foto, nessun movimento;
#   - Dal sito: codice SITOPROVA1 (un codice che l'app non crea), peso 5;
#   - con -Pallino: anche un carico di 2 pezzi (3 g, peso a mano) del primo pallino a filo.
# Va lanciato una volta sola, su una sede appena installata: se la collezione Prova c'e' gia' si ferma.
# Di solito si lancia da sede-locale.ps1 (comando "dati"), che gli passa i percorsi.
param([string]$Base = 'http://localhost:8080',
      [Parameter(Mandatory)][string]$Credenziali,   # file con AdminEmail e AdminPassword (vedi sede-locale.ps1)
      [string]$Esito = '.',
      [string]$Foto = 'C:\DeSimone\dati\foto',      # cartella delle foto della sede, solo per il riepilogo
      [string]$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe',   # per l'articolo del sito: l'app non lo può creare
      [switch]$Pallino)

$ErrorActionPreference = 'Stop'
$cred = Get-Content $Credenziali | ConvertFrom-StringData
function Passo($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# Richiesta come quelle dell'app: JSON in UTF-8, token dell'amministratore, risposta con le righe create
function Api($method, $path, $body = $null) {
  $p = @{ Method = $method; Uri = "$Base$path"; Headers = $script:headers }
  if ($null -ne $body) {
    $p.ContentType = 'application/json; charset=utf-8'
    $p.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $body -Depth 5 -Compress))
  }
  # PowerShell 5.1 restituisce un array JSON come un oggetto solo: lo si apre, cosi' [] non conta come una riga
  try { $r = Invoke-RestMethod @p; if ($r -is [array]) { foreach ($x in $r) { $x } } else { $r } }
  catch {
    # Il messaggio di PostgreSQL e' nel corpo della risposta; PowerShell 5.1 non sempre lo mette in ErrorDetails
    $msg = $_.ErrorDetails.Message
    if (-not $msg -and $_.Exception.Response) {
      $msg = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
    }
    if (-not $msg) { $msg = $_.Exception.Message }
    throw "$method $path -> $msg"
  }
}
function Una($path) {
  $r = @(Api GET $path)
  if (-not $r.Count) { throw "Non trovato: $path" }
  $r[0]
}

# Gioiello creato come in article-form.js: il codice lo assegna il server, provvisorio fino al primo carico
function NuovoGioiello($nome, $material) {
  Api POST '/rest/v1/rpc/create_article' @{
    p_collection_id = $coll.id; p_product_type_id = $type.id; p_name = $nome; p_metal_id = $metal.id
    p_price_retail = 100; p_measurements = @{ weight_g = 5 }; p_rows = @(@{ material_id = $material.id }) }
}
# Carico come in movimenti.js: il codice del movimento nasce qui, con articolo, tipo, momento e dispositivo
function Carico($codice, $campi) {
  $now = Get-Date
  $mov = Api POST '/rest/v1/rpc/register_movement' (@{
    p_code = "$codice-C-$($now.ToString('yyyyMMdd-HHmmss'))-PC1"; p_movement_type = 'C'; p_reason_id = $reason.id
    p_device_id = $device.id; p_occurred_at = $now.ToUniversalTime().ToString('o'); p_to_location_id = $lab.id } + $campi)
  "movimento $($mov.movement.code)"
}

Passo 'Accesso come amministratore'
$login = Invoke-RestMethod -Method POST -Uri "$Base/auth/login" -ContentType 'application/json' `
  -Body (ConvertTo-Json @{ email = $cred.AdminEmail; password = $cred.AdminPassword })
$script:headers = @{ Authorization = "Bearer $($login.access_token)"; Prefer = 'return=representation' }
"entrato come $($cred.AdminEmail)"

if (@(Api GET '/rest/v1/collections?select=id&code=eq.PRV&deleted_at=is.null').Count) {
  throw 'La collezione PRV c''e'' gia'': questo script va lanciato su una sede appena installata'
}

Passo 'Anagrafiche'
$materials = @(Api GET '/rest/v1/materials?select=id,name,code&active=eq.true&order=name')
$metal = Una '/rest/v1/metals?select=id,name,code&order=name&limit=1'
$type = @(Api GET '/rest/v1/product_types?select=id,name,slug&order=sort_order')
$type = @($type | Where-Object { $_.slug -like 'anell*' }) + $type | Select-Object -First 1
$lab = Una '/rest/v1/locations?select=id,name&name=eq.Laboratorio'
$reason = Una '/rest/v1/movement_reasons?select=id,name&code=eq.prima_produzione&active=eq.true'
if ($materials.Count -lt 2) { throw 'Servono almeno due materiali' }
"tipo $($type.name), metallo $($metal.name), materiali $($materials[0].name) e $($materials[1].name)"

Passo 'Collezione Prova (PRV)'
$coll = @(Api POST '/rest/v1/collections' @{ name = 'Prova'; slug = 'prv-prova'; code = 'PRV'; color = '#C94030' })[0]
$coll.id

Passo 'Anello Usato e carico di 2 pezzi'
$usato = NuovoGioiello 'Anello Usato' $materials[0]
$usato.sku
$device = @(Api GET '/rest/v1/devices?select=id,code&code=eq.PC1&revoked_at=is.null')
if ($device.Count) { $device = $device[0] } else { $device = @(Api POST '/rest/v1/devices' @{ code = 'PC1'; name = 'PC delle prove' })[0] }
# Il primo carico porta la conferma del codice, come "Confermo e proseguo" in movimenti.js
Carico $usato.sku @{ p_article_id = $usato.id; p_pieces = 2; p_confirm_code = $usato.sku }

Passo 'Anello Nuovo, con una foto'
$nuovo = NuovoGioiello 'Anello Nuovo' $materials[1]
$nuovo.sku
# Una foto vera, come la caricherebbe uploadPhoto in js/supabase.js: file in /foto, poi la riga in photos
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 240, 240
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(201, 64, 48))
$g.DrawString('PROVA', (New-Object System.Drawing.Font('Arial', 32)), [System.Drawing.Brushes]::White, 40, 95)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$photoPath = "raw/$($nuovo.id)/$([guid]::NewGuid()).png"
Invoke-RestMethod -Method PUT -Uri "$Base/foto/$photoPath" -Headers @{ Authorization = $script:headers.Authorization } `
  -ContentType 'image/png' -Body $ms.ToArray() | Out-Null
Api POST '/rest/v1/photos' @{ article_id = $nuovo.id; storage_path = $photoPath; public_url = "$Base/foto/$photoPath"
  photo_type = 'raw'; processing_status = 'pending' } | Out-Null
$photoPath

Passo 'Dal sito (SITOPROVA1)'
# Un codice che l'app non crea: lo scrive solo un import, senza token. Con psql, come sede\importa-catalogo.js
$env:PGPASSWORD = $cred.PostgresPassword
& $Psql -U postgres -d desimone -v ON_ERROR_STOP=1 -q -c "INSERT INTO articles (collection_id, name, product_type_id, sku, measurements) VALUES ('$($coll.id)', 'Dal sito', '$($type.id)', 'SITOPROVA1', jsonb_build_object('weight_g', 5))"
if ($LASTEXITCODE) { throw 'psql: articolo del sito non creato' }
'SITOPROVA1'

$pallinoRiga = ''
if ($Pallino) {
  Passo 'Pallino: carico di 2 pezzi (3 g)'
  # I semilavorati sono a pezzi e grammi: anche il carico vuole il peso (023); PC1 non ha bilancia, quindi a mano
  $raw = Una '/rest/v1/raw_items?select=id,sku,raw_shapes!inner(slug)&raw_shapes.slug=eq.filo&deleted_at=is.null&order=sku&limit=1'
  Carico $raw.sku @{ p_raw_item_id = $raw.id; p_pieces = 2; p_grams = 3; p_weight_source = 'mano' }
  $pallinoRiga = "`nPALLINO       $($raw.sku)   2 pezzi, 3 g in Laboratorio"
}

$foto = Join-Path $Foto ($photoPath -replace '/', '\')
$riepilogo = @"
Dati di prova ($((Get-Date).ToString('dd/MM/yyyy HH:mm')))
CODICE_USATO  $($usato.sku)   Anello Usato: $($materials[0].name), $($metal.name), 2 pezzi in Laboratorio
CODICE_NUOVO  $($nuovo.sku)   Anello Nuovo: $($materials[1].name), $($metal.name), nessun movimento
Foto di Anello Nuovo: $foto
Dal sito      SITOPROVA1
Dispositivo   PC1 (in Movimenti scegli "Usa questo dispositivo")$pallinoRiga
"@
Passo 'Fatto: da annotare'
Write-Host $riepilogo -ForegroundColor Green
$riepilogo | Set-Content (Join-Path $Esito 'dati-prova.txt') -Encoding UTF8
