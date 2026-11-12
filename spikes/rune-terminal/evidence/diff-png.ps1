# Pixel diff for two PNGs of the same size: how many pixels changed, the largest channel delta,
# and a diff image where a changed pixel is drawn magenta so the change is visible.
# Used to check this round's renders against the round-4 ones.
param(
  [Parameter(Mandatory = $true)][string]$A,
  [Parameter(Mandatory = $true)][string]$B,
  [string]$Out = ""
)
Add-Type -AssemblyName System.Drawing

$ia = [System.Drawing.Bitmap]::new((Resolve-Path $A).Path)
$ib = [System.Drawing.Bitmap]::new((Resolve-Path $B).Path)
if ($ia.Width -ne $ib.Width -or $ia.Height -ne $ib.Height) {
  Write-Output "SIZE_DIFF $A ($($ia.Width)x$($ia.Height)) vs $B ($($ib.Width)x$($ib.Height))"
  exit 2
}

$diff = if ($Out) { [System.Drawing.Bitmap]::new($ia.Width, $ia.Height) } else { $null }
$changed = 0
$max = 0
for ($y = 0; $y -lt $ia.Height; $y++) {
  for ($x = 0; $x -lt $ia.Width; $x++) {
    $pa = $ia.GetPixel($x, $y)
    $pb = $ib.GetPixel($x, $y)
    $d = [Math]::Max([Math]::Abs($pa.R - $pb.R), [Math]::Max([Math]::Abs($pa.G - $pb.G), [Math]::Abs($pa.B - $pb.B)))
    if ($d -gt 0) {
      $changed++
      if ($d -gt $max) { $max = $d }
    }
    if ($diff) {
      $diff.SetPixel($x, $y, $(if ($d -gt 0) { [System.Drawing.Color]::FromArgb(255, 0, 255, 255) } else { [System.Drawing.Color]::FromArgb(255, 16, 16, 16) }))
    }
  }
}
$total = $ia.Width * $ia.Height
$pct = [Math]::Round(100.0 * $changed / $total, 3)
Write-Output ("DIFF {0} vs {1}: {2}/{3} px changed ({4}%), max channel delta {5}" -f (Split-Path $A -Leaf), (Split-Path $B -Leaf), $changed, $total, $pct, $max)
$ia.Dispose()
$ib.Dispose()
if ($diff) {
  $diff.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png)
  $diff.Dispose()
  Write-Output "diff image: $Out"
}