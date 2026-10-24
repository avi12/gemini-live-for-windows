<#
.SYNOPSIS
  Installs Gemini Live from a GitHub release: trusts the package's signing certificate (one UAC
  prompt, first time only) and installs or updates the app. Shipped next to the .msix and .cer.

.DESCRIPTION
  Run it from the folder you downloaded the release files to:
    powershell -ExecutionPolicy Bypass -File .\Install-GeminiLive.ps1
  Then choose Gemini Live for Win+C under Settings > Personalization > Text input >
  Customize Copilot key on keyboard; the script opens that page when it's done.
#>
param([string] $Folder = $PSScriptRoot)
$ErrorActionPreference = 'Stop'

$msix = Get-ChildItem $Folder -Filter 'GeminiLive-*.msix' | Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
$cer  = Join-Path $Folder 'GeminiLive.cer'
if (-not $msix) { throw "No GeminiLive-*.msix in $Folder" }
if (-not (Test-Path $cer)) { throw "GeminiLive.cer is missing from $Folder" }

# Windows only installs a sideloaded package whose signer it trusts; the release is signed with a
# self-signed certificate, so it has to be trusted once, machine-wide (that needs admin).
$thumbprint = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cer).Thumbprint
$trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $thumbprint
if (-not $trusted) {
    Write-Host 'Trusting the Gemini Live signing certificate (UAC prompt)...'
    Start-Process powershell -Verb RunAs -Wait -ArgumentList `
        "-NoProfile -Command Import-Certificate -FilePath '$cer' -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
}

Write-Host "Installing $($msix.Name)..."
Add-AppxPackage $msix.FullName -ForceApplicationShutdown
Write-Host 'Installed. Choose Gemini Live under "Customize Copilot key on keyboard" to start it with Win+C.'
Start-Process 'ms-settings:personalization-textinput'
