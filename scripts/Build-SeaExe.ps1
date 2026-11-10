<#
.SYNOPSIS
  Turns the bundled Node into GeminiLive.exe: a Node single executable application (SEA) that runs
  the built app (main.js beside it) and doubles as the browsers' native messaging host (host.js).

.DESCRIPTION
  Steps: take the Node scripts\Get-Node.ps1 fetched (one version, package\build-config.json), verify its
  Authenticode signature, make a SEA blob of a tiny CommonJS stub (app\src\entry\sea-stub.ts), inject
  it into a copy of node.exe with postject (pinned: Node 24 has no --build-sea, that arrives in 25.5),
  flip the PE subsystem to Windows GUI so no console shows (stdin and stdout pipes still work), then
  run scripts\sea\selftest against the result: it must start, run a Worker with top-level await,
  load dynwinrt, call Win32 and exit 0 when stdin closes. Prints the exe size and cold start.

  AUTHENTICODE: node.exe is signed by the Node.js Foundation, and that signature is verified BEFORE
  the injection. postject rewrites the file, so the produced exe is NOT signed by Node and Windows
  reports its signature as corrupt. That is harmless inside an MSIX, which is signed as a whole
  (scripts\install.ps1); never describe this exe as Node-signed, and never ship it outside the MSIX
  unsigned.

.PARAMETER OutDirectory
  Where GeminiLive.exe is written. It must be the folder that holds main.js, host.js and
  node_modules (the app build output), because the stub imports them from the exe's own folder.

.PARAMETER SkipSelfTest
  Skips the run against the fixture.

.EXAMPLE
  pwsh scripts\Build-SeaExe.ps1 -OutDirectory build\app
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $OutDirectory,
  [string] $FileName = 'GeminiLive.exe',
  [switch] $SkipSelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PostjectVersion = '1.0.0-alpha.6'
$SeaFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
$DynwinrtEntry = 'node_modules\@microsoft\dynwinrt\dist\win32-unsafe.js'

$root = Split-Path $PSScriptRoot -Parent
$sea = Join-Path $PSScriptRoot 'sea'
$app = Join-Path $root 'app'

function Invoke-Native([string] $what, [scriptblock] $command) {
  & $command
  if ($LASTEXITCODE) { throw "$what failed (exit $LASTEXITCODE)" }
}

$node = & (Join-Path $PSScriptRoot 'Get-Node.ps1') | Select-Object -Last 1
$signature = Get-AuthenticodeSignature $node
if ($signature.Status -ne 'Valid') { throw "$node is not validly signed ($($signature.Status)); refusing to build on it" }
Write-Host "   source node.exe signed by: $($signature.SignerCertificate.Subject)"

New-Item -ItemType Directory $OutDirectory -Force | Out-Null
$exe = Join-Path (Resolve-Path $OutDirectory) $FileName
$work = Join-Path ([IO.Path]::GetTempPath()) "gemini-live-sea-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory $work | Out-Null
try {
  $stub = Join-Path $work 'stub.cjs'
  $blob = Join-Path $work 'sea.blob'
  $config = Join-Path $work 'sea.json'
  Invoke-Native 'stub' { & $node (Join-Path $sea 'prepare.ts') stub $stub }
  [ordered] @{ main = $stub; output = $blob; disableExperimentalSEAWarning = $true; useCodeCache = $false } |
    ConvertTo-Json | Set-Content $config -Encoding utf8NoBOM
  Invoke-Native 'sea blob' { & $node --experimental-sea-config $config }

  Copy-Item $node $exe -Force
  # pnpm dlx runs the pinned postject without adding it to any package.json.
  Invoke-Native 'postject' { pnpm dlx "postject@$PostjectVersion" $exe NODE_SEA_BLOB $blob --sentinel-fuse $SeaFuse --overwrite }
  Invoke-Native 'subsystem' { & $node (Join-Path $sea 'prepare.ts') gui-subsystem $exe }
  Invoke-Native 'strip signature' { & $node (Join-Path $sea 'prepare.ts') strip-signature $exe }

  if (-not $SkipSelfTest) {
    $fixture = Join-Path $work 'self test'
    New-Item -ItemType Directory $fixture | Out-Null
    Copy-Item (Join-Path $sea 'selftest\*') $fixture
    $testExe = Join-Path $fixture $FileName
    Copy-Item $exe $testExe
    $dynwinrt = (Resolve-Path (Join-Path $app $DynwinrtEntry)).Path
    Invoke-Native 'self test' { & $node (Join-Path $sea 'selftest.ts') $testExe $dynwinrt }
  }
}
finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "   built $exe"
$exe
