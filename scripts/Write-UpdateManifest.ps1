<#
.SYNOPSIS
  Writes docs/updates.json, the manifest installed copies of Gemini Live poll to find out whether
  a newer release exists.

.DESCRIPTION
  Names the version in package\AppxManifest.xml, where that release's package is (the asset
  GeminiLive-<major.minor.build>.msix on the GitHub release v<major.minor.build>) and its SHA-256,
  which an installed copy checks its download against. Run it after the release's package is
  attached, then push docs/updates.json to main: until then installed copies see no update, so the
  manifest never points at a package that is not there yet.

.PARAMETER Package
  The .msix attached to the release (from `install.ps1 -Mode Release`, in build\release).

.EXAMPLE
  pwsh scripts\Write-UpdateManifest.ps1 -Package build\release\GeminiLive-0.0.2.msix
#>
param(
    [Parameter(Mandatory)]
    [string] $Package
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$repository = 'avi12/gemini-live-for-windows'

[xml] $manifest = Get-Content (Join-Path $root 'package\AppxManifest.xml')
$version = [version] $manifest.Package.Identity.Version
$short = '{0}.{1}.{2}' -f $version.Major, $version.Minor, $version.Build
$file = "GeminiLive-$short.msix"
$path = (Resolve-Path $Package).Path
if ((Split-Path $path -Leaf) -ne $file) {
    throw "$path is not named $file, the asset for the manifest's version $version. Build the release first."
}

$update = [ordered]@{
    version = $version.ToString()
    url     = "https://github.com/$repository/releases/download/v$short/$file"
    sha256  = (Get-FileHash $path -Algorithm SHA256).Hash
}
$target = Join-Path $root 'docs\updates.json'
($update | ConvertTo-Json) + "`n" | Set-Content $target -Encoding utf8NoBOM -NoNewline
Write-Host "wrote $target"
Get-Content $target
