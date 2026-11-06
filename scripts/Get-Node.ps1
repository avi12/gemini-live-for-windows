<#
.SYNOPSIS
  Fetches the Node the pill runs on and caches it in build\node\<version>; prints the path of node.exe.

.DESCRIPTION
  The app ships its own node.exe (pill\node.exe), so it never relies on the machine having Node.
  The version is Directory.Build.props' BundledNodeVersion, the one place it is written. The win-x64
  zip comes from nodejs.org and must match the SHA-256 in that release's SHASUMS256.txt; only
  node.exe, whose Authenticode signature must be valid, and Node's LICENSE (MIT, kept in the package
  for compliance) are extracted. A cached copy is reused.

.EXAMPLE
  pwsh scripts\Get-Node.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell 5.1 crawls with the progress bar on

$root = Split-Path $PSScriptRoot -Parent
[xml] $props = Get-Content (Join-Path $root 'Directory.Build.props')
$version = $props.Project.PropertyGroup.BundledNodeVersion | Where-Object { $_ } | Select-Object -First 1
if (-not $version) { throw 'Directory.Build.props has no BundledNodeVersion' }

$folder = Join-Path $root "build\node\$version"
$node = Join-Path $folder 'node.exe'
$license = Join-Path $folder 'LICENSE'
if ((Test-Path $node) -and (Test-Path $license)) { return $node }

$archive = "node-v$version-win-x64"
$base = "https://nodejs.org/dist/v$version"
$work = Join-Path ([IO.Path]::GetTempPath()) "gemini-live-node-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory $work | Out-Null
try {
  $zip = Join-Path $work "$archive.zip"
  Write-Host "   downloading Node $version"
  Invoke-WebRequest "$base/$archive.zip" -OutFile $zip
  $sums = (Invoke-WebRequest "$base/SHASUMS256.txt").Content -split "`n"
  $line = $sums | Where-Object { $_ -match "\s$([regex]::Escape("$archive.zip"))\s*$" } | Select-Object -First 1
  if (-not $line) { throw "SHASUMS256.txt lists no $archive.zip" }
  $expected = ($line -split '\s+')[0]
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
  if ($actual -ne $expected) { throw "$archive.zip hash $actual differs from nodejs.org's $expected" }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $source = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    New-Item -ItemType Directory $folder -Force | Out-Null
    foreach ($entry in 'node.exe', 'LICENSE') {
      $item = $source.GetEntry("$archive/$entry")
      if (-not $item) { throw "$archive.zip has no $entry" }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($item, (Join-Path $folder $entry), $true)
    }
  }
  finally { $source.Dispose() }

  $signature = Get-AuthenticodeSignature $node
  if ($signature.Status -ne 'Valid') { throw "node.exe is not validly signed ($($signature.Status))" }
}
catch {
  if (Test-Path $folder) { Remove-Item $folder -Recurse -Force }
  throw
}
finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }

$node
