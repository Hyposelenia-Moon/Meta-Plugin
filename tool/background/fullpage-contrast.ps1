param(
  [string]$Css = 'resources\common\base.css',
  [string]$BgDir = 'resources\common',
  [int]$Downscale = 28
)
# ASCII-only: contrast audit against the REAL artwork of the dark illustration theme.
# Chain modelled exactly like the CSS: artwork (blurred) -> --scrim -> --card -> (--chip | --card-2).
# Light text is worst on the BRIGHTEST background, so we sample the brightest blurred artwork pixel.
# The authoritative gate is test/contrast.test.mjs (analytical, worst case = pure white artwork);
# this script only re-checks the real images and prints realistic numbers.
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

function Srgb([double]$c) {
  $v = $c / 255.0
  if ($v -le 0.03928) { return $v / 12.92 }
  return [math]::Pow((($v + 0.055) / 1.055), 2.4)
}
function RelLum($rgb) { return 0.2126 * (Srgb $rgb[0]) + 0.7152 * (Srgb $rgb[1]) + 0.0722 * (Srgb $rgb[2]) }
function Contrast($fg, $bg) {
  $l1 = RelLum $fg; $l2 = RelLum $bg
  return ([math]::Max($l1, $l2) + 0.05) / ([math]::Min($l1, $l2) + 0.05)
}
# overlay a (rgb + alpha) colour onto an opaque rgb background
# NB: products are computed into locals first -- Windows PowerShell 5.1 mis-parses `*` inside @( )
function Over($fg, $bg) {
  $a = $fg[3]
  $r = $fg[0] * $a + $bg[0] * (1 - $a)
  $g = $fg[1] * $a + $bg[1] * (1 - $a)
  $b = $fg[2] * $a + $bg[2] * (1 - $a)
  return @($r, $g, $b)
}

# ---- tokens come from base.css (single source of truth) ----
$cssText = Get-Content -Raw -LiteralPath $Css
function Token([string]$name) {
  $m = [regex]::Match($cssText, '--' + [regex]::Escape($name) + '\s*:\s*([^;]+);')
  if (-not $m.Success) { throw "token --$name not found in $Css" }
  $raw = $m.Groups[1].Value.Trim()
  $hex = [regex]::Match($raw, '^#([0-9a-fA-F]{6})$')
  if ($hex.Success) {
    $h = $hex.Groups[1].Value
    return @([Convert]::ToInt32($h.Substring(0, 2), 16), [Convert]::ToInt32($h.Substring(2, 2), 16), [Convert]::ToInt32($h.Substring(4, 2), 16), 1.0)
  }
  $rgba = [regex]::Match($raw, 'rgba?\(([^)]+)\)')
  if ($rgba.Success) {
    $p = $rgba.Groups[1].Value -split ','
    $a = if ($p.Count -gt 3) { [double]$p[3].Trim() } else { 1.0 }
    return @([double]$p[0].Trim(), [double]$p[1].Trim(), [double]$p[2].Trim(), $a)
  }
  throw "cannot parse colour for --$name : $raw"
}

# brightest local-mean pixel = worst case for LIGHT text (blur compresses toward the local mean)
function BrightestBlurred([string]$path) {
  $src = [System.Drawing.Bitmap]::new($path)
  $w = [math]::Max(8, [int]($src.Width / $Downscale)); $h = [math]::Max(8, [int]($src.Height / $Downscale))
  $small = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose()
  $best = $null; $bestL = -1.0
  for ($y = 0; $y -lt $h; $y += 2) {
    for ($x = 0; $x -lt $w; $x += 2) {
      $p = $small.GetPixel($x, $y)
      $rgb = @([double]$p.R, [double]$p.G, [double]$p.B)
      $l = RelLum $rgb
      if ($l -gt $bestL) { $bestL = $l; $best = $rgb }
    }
  }
  $small.Dispose(); $src.Dispose()
  return $best
}

$scrim = Token 'scrim'
$card = Token 'card'
$chip = Token 'chip'
$card2 = Token 'card-2'

# specs: label | token | surface (card / chip / inner) | px | bold
$specs = @(
  @{ n = 'text 20px'; t = 'text'; s = 'card'; px = 20; b = $false },
  @{ n = 'text-2 15px'; t = 'text-2'; s = 'card'; px = 15; b = $false },
  @{ n = 'muted 17px'; t = 'muted'; s = 'card'; px = 17; b = $false },
  @{ n = 'muted-2 18px'; t = 'muted-2'; s = 'card'; px = 18; b = $false },
  @{ n = 'muted 16px on inner'; t = 'muted'; s = 'inner'; px = 16; b = $false },
  @{ n = 'accent 18px bold'; t = 'accent'; s = 'card'; px = 18; b = $true },
  @{ n = 'accent-2 16px'; t = 'accent-2'; s = 'card'; px = 16; b = $false },
  @{ n = 'gold 19px bold'; t = 'gold'; s = 'card'; px = 19; b = $true },
  @{ n = 'green 16px'; t = 'green'; s = 'card'; px = 16; b = $false },
  @{ n = 'red 15px'; t = 'red'; s = 'card'; px = 15; b = $false },
  @{ n = 'tag accent 18px on chip'; t = 'accent'; s = 'chip'; px = 18; b = $false },
  @{ n = 'tag green 18px on chip'; t = 'green'; s = 'chip'; px = 18; b = $false },
  @{ n = 'tag gold 18px on chip'; t = 'gold'; s = 'chip'; px = 18; b = $false },
  @{ n = 'tag accent-2 18px on chip'; t = 'accent-2'; s = 'chip'; px = 18; b = $false }
)

$pages = @('rank', 'raid', 'build', 'help', 'status')
$totalFail = 0
foreach ($page in $pages) {
  $path = Join-Path $BgDir ("bg-{0}.jpg" -f $page)
  $art = BrightestBlurred $path
  $cardBg = Over $card (Over $scrim $art)
  $chipBg = Over $chip $cardBg
  $innerBg = Over $card2 $cardBg
  $surfaces = @{ card = $cardBg; chip = $chipBg; inner = $innerBg }
  Write-Output ("== {0} ==  brightest artwork {1}  ->  card {2}" -f $page, (($art | ForEach-Object { [int]$_ }) -join ','), (($cardBg | ForEach-Object { [int]$_ }) -join ','))
  $fail = 0
  foreach ($spec in $specs) {
    $bg = $surfaces[$spec.s]
    $ratio = Contrast (Token $spec.t) $bg
    $large = ($spec.px -ge 24) -or ($spec.b -and $spec.px -ge 18.66)
    $need = if ($large) { 3.0 } else { 4.5 }
    $ok = $ratio -ge $need
    if (-not $ok) { $fail++ }
    Write-Output ("   {0,-26} {1,6:N2}  need {2}  {3}" -f $spec.n, $ratio, $need, $(if ($ok) { 'PASS' } else { 'FAIL' }))
  }
  Write-Output ("   -> FAILED {0} / {1}" -f $fail, $specs.Count)
  $totalFail += $fail
}
Write-Output ("TOTAL FAILED {0}" -f $totalFail)
