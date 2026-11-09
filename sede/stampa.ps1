# sede/stampa.ps1 - Stampa una richiesta di etichette sulla stampante di Windows (pacchetto 3.3)
#
# Lo lancia il servizio della sede (sede\servizio\stampa.js), una volta per richiesta: tutte le copie in un solo
# documento, una pagina da 62x29 mm per faccia. Il disegno arriva gia' fatto, in millimetri, in un file JSON:
#   { "nome": "...", "w": 62, "h": 29, "pagine": [ [ elemento, ... ], ... ] }
#   elemento: { "t": "qr", "x", "y", "lato", "righe": ["0110...", ...] }
#             { "t": "testo", "s", "x", "y", "w", "h", "pt", "font"?, "grassetto"?, "centro"?, "a_capo"?, "colore"? }
#             { "t": "punto", "x", "y", "r", "colore" }
# Usa solo System.Drawing di Windows: niente da scaricare (REQ-003).
#
# Uso:  powershell -ExecutionPolicy Bypass -File sede\stampa.ps1 -Lavoro <file.json> -Stampante "Brother QL-800"
#       [-SuFile <file.pdf>]   per provare senza la stampante, con -Stampante "Microsoft Print to PDF"
param([Parameter(Mandatory = $true)][string]$Lavoro,
      [Parameter(Mandatory = $true)][string]$Stampante,
      [string]$SuFile = '')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$job = Get-Content -Raw -Encoding UTF8 $Lavoro | ConvertFrom-Json
if (-not $job.pagine -or $job.pagine.Count -eq 0) { throw 'Niente da stampare' }

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Stampante
if (-not $doc.PrinterSettings.IsValid) { throw "Stampante non trovata: $Stampante. Controlla il nome in Impostazioni > Stampanti" }
if ($SuFile) {
  $doc.PrinterSettings.PrintToFile = $true
  $doc.PrinterSettings.PrintFileName = $SuFile
}
$doc.DocumentName = $job.nome

# La carta: quella del driver da 62x29 se c'e', altrimenti su misura. In centesimi di pollice
$w = [int][math]::Round($job.w / 25.4 * 100)
$h = [int][math]::Round($job.h / 25.4 * 100)
$paper = $doc.PrinterSettings.PaperSizes | Where-Object {
  ([math]::Abs($_.Width - $w) -le 3 -and [math]::Abs($_.Height - $h) -le 3) -or
  ([math]::Abs($_.Width - $h) -le 3 -and [math]::Abs($_.Height - $w) -le 3) } | Select-Object -First 1
if (-not $paper) { $paper = New-Object System.Drawing.Printing.PaperSize('De Simone 62x29', $w, $h) }
$doc.DefaultPageSettings.PaperSize = $paper
$doc.DefaultPageSettings.Landscape = $false
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.OriginAtMargins = $false

$script:pagina = 0
$doc.add_PrintPage({
  param($sender, $e)
  $g = $e.Graphics
  $g.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
  # Il driver conta da dove la stampante comincia a stampare: si torna al bordo vero della carta
  $g.TranslateTransform(-$e.PageSettings.HardMarginX * 0.254, -$e.PageSettings.HardMarginY * 0.254)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit

  foreach ($el in $job.pagine[$script:pagina]) {
    $colore = if ($el.colore) { [System.Drawing.ColorTranslator]::FromHtml($el.colore) } else { [System.Drawing.Color]::Black }
    $pennello = New-Object System.Drawing.SolidBrush($colore)
    switch ($el.t) {
      'qr' {
        $n = $el.righe.Count
        $m = [single]($el.lato / $n)
        for ($r = 0; $r -lt $n; $r++) {
          $riga = $el.righe[$r]
          for ($c = 0; $c -lt $riga.Length; $c++) {
            # Un poco piu' grandi, cosi' tra due moduli neri non resta una riga bianca
            if ($riga[$c] -eq '1') { $g.FillRectangle($pennello, [single]($el.x + $c * $m), [single]($el.y + $r * $m), [single]($m + 0.02), [single]($m + 0.02)) }
          }
        }
      }
      'testo' {
        $stile = if ($el.grassetto) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
        $famiglia = if ($el.font) { $el.font } else { 'Arial' }
        $font = New-Object System.Drawing.Font($famiglia, [single]$el.pt, $stile, [System.Drawing.GraphicsUnit]::Point)
        $formato = New-Object System.Drawing.StringFormat
        if (-not $el.a_capo) { $formato.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap }
        $formato.Trimming = [System.Drawing.StringTrimming]::None
        $formato.Alignment = if ($el.centro) { [System.Drawing.StringAlignment]::Center } else { [System.Drawing.StringAlignment]::Near }
        $box = New-Object System.Drawing.RectangleF([single]$el.x, [single]$el.y, [single]$el.w, [single]($el.h + 0.3))
        $g.DrawString([string]$el.s, $font, $pennello, $box, $formato)
        $font.Dispose()
      }
      'punto' {
        $g.FillEllipse($pennello, [single]($el.x - $el.r), [single]($el.y - $el.r), [single](2 * $el.r), [single](2 * $el.r))
      }
    }
    $pennello.Dispose()
  }
  $script:pagina++
  $e.HasMorePages = $script:pagina -lt $job.pagine.Count
})

$doc.Print()
"stampate $($job.pagine.Count) pagine su $Stampante"
