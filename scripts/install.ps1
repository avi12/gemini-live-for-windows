<#
.SYNOPSIS
  Builds Gemini Live, packages it as MSIX and installs it so it shows up under
  Settings > Personalization > Text input > "Customize Copilot key on keyboard" (Win+C).

.PARAMETER Mode
  Signed   (default) pack + sign with a local self-signed cert. Windows only enables signed
           Copilot key providers. Trusting the cert needs one UAC prompt, first time only.
  Register dev-mode loose registration, no signing. Fastest inner loop for code changes.
  Release  pack + sign at exactly the manifest's version, without installing, and gather what a
           GitHub release ships in build\release: the .msix, the signing .cer, Install-GeminiLive.ps1,
           and the extension's .zip and signed .crx (keys\chrome.pem).
#>
param([ValidateSet('Signed', 'Register', 'Release')] [string] $Mode = 'Signed')
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

# The minimum Windows lives in Directory.Build.props; the manifest has to repeat it, so stop on drift.
[xml] $props = Get-Content (Join-Path $root 'Directory.Build.props')
$minWindows  = $props.Project.PropertyGroup.SupportedOSPlatformVersion
$manifestMin = $manifest.Package.Dependencies.TargetDeviceFamily.MinVersion
if ($manifestMin -ne $minWindows) {
    throw "AppxManifest.xml MinVersion $manifestMin differs from Directory.Build.props $minWindows"
}

$release = $Mode -eq 'Release'

# Runs a native tool and stops the script if it fails; $what names it in the error.
function Invoke-Native([string] $what, [scriptblock] $command) {
    & $command
    if ($LASTEXITCODE) { throw "$what failed" }
}

# One pnpm workspace package's script, by folder under the repo root.
function Invoke-Pnpm([string] $package, [string] $task) {
    Invoke-Native "$package $task" { pnpm --dir (Join-Path $root $package) $task }
}

# A .NET project, published into the package layout.
function Publish-Project([string] $project) {
    Invoke-Native "dotnet publish ($project)" {
        dotnet publish (Join-Path $root "src\$project\$project.csproj") -c Release -o $layout --nologo -v q
    }
}

# Stop a running copy (and a host a browser has open) so its files can be replaced. A release only
# builds files, so the installed app keeps running.
if (-not $release) {
    Get-Process GeminiLive, GeminiLiveHost -ErrorAction SilentlyContinue | Stop-Process -Force
}

# One pnpm workspace: the messaging package, the extension and the bridges install together.
Write-Host '== install'
Invoke-Native 'pnpm install' { pnpm --dir $root install --silent }

Write-Host '== messaging'
Invoke-Pnpm 'messaging' 'typecheck'

Write-Host '== extension'
# A release also zips the extension and signs its .crx.
Invoke-Pnpm 'extension' $(if ($release) { 'release' } else { 'build' })

Write-Host '== bridge'
Invoke-Pnpm 'bridge' 'build'

Write-Host '== publish'
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
Publish-Project 'GeminiLive'
# The browsers' native messaging host ships beside the app (its execution alias is in the manifest).
Publish-Project 'GeminiLiveHost'
Copy-Item (Join-Path $root 'package\*') $layout -Recurse -Force

# Update in place rather than remove + add: removing the package wipes the permissions Windows keeps
# for it, so every install re-asked for the microphone. An in-place update needs a higher version,
# so a local install gets major.minor from the manifest plus a build stamp (days since 2026, then
# 2-second ticks of the day - both stay under the 65535 a version part allows). A release keeps the
# manifest's version as it is.
$base   = [version] $manifest.Package.Identity.Version
$now    = Get-Date
$layoutManifestPath = Join-Path $layout 'AppxManifest.xml'
if (-not $release) {
    [xml] $layoutManifest = Get-Content $layoutManifestPath
    $layoutManifest.Package.Identity.Version =
        '{0}.{1}.{2}.{3}' -f $base.Major, $base.Minor, ($now - [datetime] '2026-01-01').Days,
                             [int] ($now.TimeOfDay.TotalSeconds / 2)
    $layoutManifest.Save($layoutManifestPath)
}

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
    Invoke-Native 'makeappx' { & "$sdk\makeappx.exe" pack /o /d $layout /p $msix /nv | Out-Null }
    Invoke-Native 'signtool' { & "$sdk\signtool.exe" sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix | Out-Null }

    if ($release) {
        Write-Host '== release files'
        $out = Join-Path $build 'release'
        if (Test-Path $out) { Remove-Item $out -Recurse -Force }
        New-Item -ItemType Directory $out | Out-Null
        $version = '{0}.{1}.{2}' -f $base.Major, $base.Minor, $base.Build
        Copy-Item $msix (Join-Path $out "GeminiLive-$version.msix")
        Export-Certificate -Cert $cert -FilePath (Join-Path $out 'GeminiLive.cer') | Out-Null
        Copy-Item (Join-Path $PSScriptRoot 'Install-GeminiLive.ps1') $out
        Copy-Item (Join-Path $root 'extension\.output\*.zip'), (Join-Path $root 'extension\.output\*.crx') $out
        Get-ChildItem $out | ForEach-Object { Write-Host "   $($_.Name)" }
        return
    }

    Write-Host '== install'
    Install-InPlace { Add-AppxPackage $msix -ForceApplicationShutdown }
}

$pkg = Get-AppxPackage $name
Write-Host "Installed $($pkg.PackageFullName) ($($pkg.SignatureKind))"
Write-Host 'Now: Settings > Personalization > Text input > Customize Copilot key on keyboard > Gemini Live'
