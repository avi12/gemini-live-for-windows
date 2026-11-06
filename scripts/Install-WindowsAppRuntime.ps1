<#
.SYNOPSIS
  Installs the Windows App SDK runtime a package depends on, unless a new enough one is installed.

.DESCRIPTION
  Gemini Live's package declares Microsoft.WindowsAppRuntime.2 (minimum 2.2.0.0) as a framework
  dependency; Windows does not fetch a sideloaded package's dependencies, so this installs it first.
  The installer comes from Microsoft's aka.ms link for that release and is only run when its
  Authenticode signature is valid and names Microsoft Corporation. A newer 2.x already installed
  satisfies the dependency. Pass -WhatIf to see what it would do.

.PARAMETER Name
  The framework package's name, as in the manifest's PackageDependency (Microsoft.WindowsAppRuntime.2).

.PARAMETER MinVersion
  The dependency's MinVersion (2.2.0.0), which names the release to install: major.minor.build.

.EXAMPLE
  pwsh scripts\Install-WindowsAppRuntime.ps1 -Name Microsoft.WindowsAppRuntime.2 -MinVersion 2.2.0.0
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)] [string] $Name,
  [Parameter(Mandatory)] [version] $MinVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-Installed {
  [bool] (Get-AppxPackage $Name | Where-Object { $_.Architecture -eq 'X64' -and $_.Version -ge $MinVersion })
}

if (Test-Installed) {
  Write-Host "   $Name $MinVersion or newer is installed"
  return
}

# Microsoft.WindowsAppRuntime.2 -> release 2.2.0, at aka.ms/windowsappsdk/2.2/2.2.0/.
$release = '{0}.{1}.{2}' -f $MinVersion.Major, $MinVersion.Minor, $MinVersion.Build
$url = "https://aka.ms/windowsappsdk/$($MinVersion.Major).$($MinVersion.Minor)/$release/windowsappruntimeinstall-x64.exe"
$work = Join-Path ([IO.Path]::GetTempPath()) "gemini-live-runtime-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory $work | Out-Null
try {
  $installer = Join-Path $work 'windowsappruntimeinstall-x64.exe'
  Write-Host "   downloading the Windows App SDK $release runtime"
  Invoke-WebRequest $url -OutFile $installer
  $signature = Get-AuthenticodeSignature $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '^CN=Microsoft Corporation(,|$)') {
    throw "The runtime installer from $url is not signed by Microsoft ($($signature.Status)); not running it. Install the Windows App SDK $release runtime by hand from https://learn.microsoft.com/windows/apps/windows-app-sdk/downloads"
  }
  if ($PSCmdlet.ShouldProcess($Name, "install the Windows App SDK $release runtime")) {
    & $installer --quiet
    if ($LASTEXITCODE) { throw "The runtime installer failed ($LASTEXITCODE)" }
    if (-not (Test-Installed)) { throw "$Name $MinVersion is still missing after its installer ran" }
  }
}
finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
