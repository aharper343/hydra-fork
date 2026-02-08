param(
  [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hydraRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$hydraScriptPath = Join-Path $hydraRoot "bin\hydra.ps1"
$profilePath = $PROFILE.CurrentUserCurrentHost
$profileDir = Split-Path -Parent $profilePath

$startMarker = "# >>> Hydra >>>"
$endMarker = "# <<< Hydra <<<"

if (-not (Test-Path -LiteralPath $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $profilePath)) {
  New-Item -ItemType File -Path $profilePath -Force | Out-Null
}

$existing = Get-Content -LiteralPath $profilePath -Raw
if ($null -eq $existing) {
  $existing = ""
}

$pattern = [regex]::Escape($startMarker) + "[\s\S]*?" + [regex]::Escape($endMarker)
$cleaned = [regex]::Replace($existing, $pattern, "").TrimEnd()

# Also clean up old SideQuest markers if present
$oldStartMarker = "# >>> SideQuest Hydra >>>"
$oldEndMarker = "# <<< SideQuest Hydra <<<"
$oldPattern = [regex]::Escape($oldStartMarker) + "[\s\S]*?" + [regex]::Escape($oldEndMarker)
$cleaned = [regex]::Replace($cleaned, $oldPattern, "").TrimEnd()

if ($Uninstall) {
  Set-Content -LiteralPath $profilePath -Value ($cleaned + [Environment]::NewLine) -Encoding UTF8
  Write-Output "Removed Hydra profile block from $profilePath"
  Write-Output "Restart terminal or run: . `$PROFILE"
  exit 0
}

$hydraScriptEscaped = $hydraScriptPath -replace "'", "''"
$block = @"
$startMarker
function hydra {
  param([Parameter(ValueFromRemainingArguments = `$true)] [string[]]`$Args)
  & pwsh -NoProfile -ExecutionPolicy Bypass -File '$hydraScriptEscaped' @Args
}
$endMarker
"@

$newContent = $cleaned
if ($newContent.Length -gt 0) {
  $newContent += [Environment]::NewLine + [Environment]::NewLine
}
$newContent += $block + [Environment]::NewLine

Set-Content -LiteralPath $profilePath -Value $newContent -Encoding UTF8

Write-Output "Installed Hydra command into PowerShell profile:"
Write-Output "- Profile: $profilePath"
Write-Output "- Script:  $hydraScriptPath"
Write-Output ""
Write-Output "Reload now with:"
Write-Output ". `$PROFILE"
Write-Output ""
Write-Output "Then run:"
Write-Output "hydra"
