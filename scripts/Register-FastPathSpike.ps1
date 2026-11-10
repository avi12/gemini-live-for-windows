<#
.SYNOPSIS
  Registers a THROWAWAY dev-mode package, Avi.GeminiLiveFastPathSpike, that answers one question: does the
  shell POST or SEND WM_APP+1 to the window of a Copilot key provider? The installed Gemini Live
  (Avi.GeminiLiveForWindows) is not touched.

.DESCRIPTION
  Takes the staged SEA layout (scripts\install.ps1 -Mode Stage), copies it to
  build\spike-layout, renames the identity, protocol, provider and aliases so nothing collides, drops
  the flag file that makes the app run app\src\entry\fast-path-spike.ts, and registers the layout.
  Then, by hand: Settings > Personalization > Text input > Customize Copilot key > "Gemini Live SPIKE",
  press Win+C (tap, hold, release) and read the log:

    %USERPROFILE%\.gemini-live\fast-path-spike.log

  Switch the Copilot key back to your usual app afterwards, then run with -Remove.

.PARAMETER Remove
  Unregisters the spike package (only that identity) and deletes build\spike-layout.
#>
[CmdletBinding()]
param([switch] $Remove)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SpikeName = 'Avi.GeminiLiveFastPathSpike'
$SpikeScheme = 'geminilive-spike'
$FlagFile = 'fast-path-spike.flag'

$root = Split-Path $PSScriptRoot -Parent
$staged = Join-Path $root 'build\layout'
$spike = Join-Path $root 'build\spike-layout'

if ($Remove) {
  Get-AppxPackage $SpikeName | Remove-AppxPackage
  if (Test-Path $spike) { Remove-Item $spike -Recurse -Force }
  Write-Host "Removed $SpikeName"
  return
}

if (-not (Test-Path (Join-Path $staged 'GeminiLive.exe'))) {
  throw 'No staged SEA layout: run  pwsh scripts\install.ps1 -Mode Stage  first'
}
if (Test-Path $spike) { Remove-Item $spike -Recurse -Force }
Copy-Item $staged $spike -Recurse
New-Item -ItemType File (Join-Path $spike $FlagFile) | Out-Null

$manifestPath = Join-Path $spike 'AppxManifest.xml'
$text = Get-Content $manifestPath -Raw
$text = $text.Replace('Avi.GeminiLiveForWindows', $SpikeName).
  Replace('geminilive-key', $SpikeScheme).
  Replace('DisplayName="Gemini Live"', 'DisplayName="Gemini Live SPIKE"').
  Replace('<DisplayName>Gemini Live</DisplayName>', '<DisplayName>Gemini Live SPIKE</DisplayName>').
  Replace('Id="GeminiLive"', 'Id="GeminiLiveSpike"')
Set-Content $manifestPath $text -Encoding utf8NoBOM

[xml] $manifest = Get-Content $manifestPath
$applications = $manifest.Package.Applications
$hostApplication = $applications.Application | Where-Object Id -eq 'NativeHost'
if ($hostApplication) { [void] $applications.RemoveChild($hostApplication) }
# A startup task of the throwaway would start it at every sign-in.
$manifest.SelectNodes("//*[local-name()='Extension'][@Category='windows.startupTask']") |
  ForEach-Object { [void] $_.ParentNode.RemoveChild($_) }
$manifest.Package.Identity.Version = '0.0.1.0'
$manifest.Save($manifestPath)

Add-AppxPackage -Register $manifestPath -ForceApplicationShutdown
$package = Get-AppxPackage $SpikeName
Write-Host "Registered $($package.PackageFullName)"
Write-Host 'Settings > Personalization > Text input > Customize Copilot key > Gemini Live SPIKE'
Write-Host 'Press Win+C: tap, then hold and release. Then read:'
Write-Host "  $env:USERPROFILE\.gemini-live\fast-path-spike.log"
Write-Host 'Switch the Copilot key back, then: pwsh scripts\Register-FastPathSpike.ps1 -Remove'
