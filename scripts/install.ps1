<#
.SYNOPSIS
  Builds Gemini Live, packages it as MSIX and installs it so it shows up under
  Settings > Personalization > Text input > "Customize Copilot key on keyboard" (Win+C).

.PARAMETER Mode
  Signed   (default) pack + sign with a local self-signed cert. Windows only enables signed
           Copilot key providers. Trusting the cert needs one UAC prompt, first time only.
  Register dev-mode loose registration, no signing. Fastest inner loop for code changes.
#>
param([ValidateSet('Signed', 'Register')] [string] $Mode = 'Signed')
$ErrorActionPreference = 'Stop'

$root    = Split-Path $PSScriptRoot -Parent
$build   = Join-Path $root 'build'
$layout  = Join-Path $build 'layout'
$msix    = Join-Path $build 'GeminiLive.msix'
$sdk     = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\10.*\x64\makeappx.exe' |
           Sort-Object FullName -Descending | Select-Object -First 1 | ForEach-Object DirectoryName
[xml] $manifest = Get-Content (Join-Path $root 'package\AppxManifest.xml')
$publisher = $manifest.Package.Identity.Publisher   # the one source for the cert subject
$name      = $manifest.Package.Identity.Name

# Stop a running copy so its files can be replaced.
Get-Process GeminiLive -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host '== extension'
pnpm --dir (Join-Path $root 'extension') install --silent
pnpm --dir (Join-Path $root 'extension') build
if ($LASTEXITCODE) { throw 'extension build failed' }

Write-Host '== publish'
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
dotnet publish (Join-Path $root 'src\GeminiLive\GeminiLive.csproj') -c Release -o $layout --nologo -v q
if ($LASTEXITCODE) { throw 'dotnet publish failed' }
Copy-Item (Join-Path $root 'package\*') $layout -Recurse -Force

# Update in place rather than remove + add: removing the package wipes the permissions Windows keeps
# for it, so every install re-asked for the microphone. An in-place update needs a higher version,
# so the packaged copy gets major.minor from the manifest plus a build stamp (days since 2026, then
# 2-second ticks of the day - both stay under the 65535 a version part allows).
$base   = [version] $manifest.Package.Identity.Version
$now    = Get-Date
$layoutManifestPath = Join-Path $layout 'AppxManifest.xml'
[xml] $layoutManifest = Get-Content $layoutManifestPath
$layoutManifest.Package.Identity.Version =
    '{0}.{1}.{2}.{3}' -f $base.Major, $base.Minor, ($now - [datetime] '2026-01-01').Days,
                         [int] ($now.TimeOfDay.TotalSeconds / 2)
$layoutManifest.Save($layoutManifestPath)

# Installs $package as an update; only if Windows refuses (e.g. switching between Signed and
# Register) does it fall back to removing the old one first.
function Install-InPlace([scriptblock] $install) {
    try { & $install }
    catch {
        Write-Host "   in-place update refused ($($_.Exception.Message.Split([Environment]::NewLine)[0])); reinstalling"
        Get-AppxPackage $name | Remove-AppxPackage
        & $install
    }
}

if ($Mode -eq 'Register') {
    Write-Host '== register (dev mode)'
    Install-InPlace { Add-AppxPackage -Register $layoutManifestPath -ForceApplicationShutdown }
}
else {
    Write-Host '== certificate'
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq $publisher | Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
            -FriendlyName 'Gemini Live (local)' -CertStoreLocation Cert:\CurrentUser\My `
            -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
    }
    $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $cert.Thumbprint
    if (-not $trusted) {
        $cer = Join-Path $build 'GeminiLive.cer'
        Export-Certificate -Cert $cert -FilePath $cer | Out-Null
        Write-Host '   trusting the local signing cert (UAC prompt)...'
        Start-Process powershell -Verb RunAs -Wait -ArgumentList `
            "-NoProfile -Command Import-Certificate -FilePath '$cer' -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
    }

    Write-Host '== pack + sign'
    & "$sdk\makeappx.exe" pack /o /d $layout /p $msix /nv | Out-Null
    if ($LASTEXITCODE) { throw 'makeappx failed' }
    & "$sdk\signtool.exe" sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix | Out-Null
    if ($LASTEXITCODE) { throw 'signtool failed' }

    Write-Host '== install'
    Install-InPlace { Add-AppxPackage $msix -ForceApplicationShutdown }
}

$pkg = Get-AppxPackage $name
Write-Host "Installed $($pkg.PackageFullName) ($($pkg.SignatureKind))"
Write-Host 'Now: Settings > Personalization > Text input > Customize Copilot key on keyboard > Gemini Live'
