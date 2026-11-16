# Pulls Google's Lens text models off your own Android phone over adb, so Select text can read Hebrew.
# The models are Google's: they stay in your own data folder and are never part of this repo or a release.
# Needs the phone connected to adb (wireless or USB) with the Google app installed.
param(
  [string]$Serial,
  [string[]]$Scripts = @('hebr')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$package = 'com.google.android.googlequicksearchbox'
$split = 'split_lens_ondevice_engine_play_ml_module.apk'
$modelPath = 'assets/lens_ondevice_text_stack_multiscript_omni/third_party/lens/line_recognition/'
$target = Join-Path $env:LOCALAPPDATA 'GeminiLive\lens-models'
$adbArgs = if ($Serial) { @('-s', $Serial) } else { @() }

$paths = & adb @adbArgs shell pm path $package
$remote = ($paths | Where-Object { $_ -like "*$split" }) -replace 'package:', '' -replace '\s', ''
if (-not $remote) { throw "The Google app on the phone has no $split" }

New-Item -ItemType Directory -Force $target | Out-Null
$apk = Join-Path ([IO.Path]::GetTempPath()) $split
& adb @adbArgs pull $remote $apk | Out-Null

$zip = [IO.Compression.ZipFile]::OpenRead($apk)
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName
    if (-not $name.StartsWith($modelPath)) { continue }
    $file = $name.Substring($modelPath.Length) -replace '^v\d+/', ''
    $isWanted = $Scripts | Where-Object { $file -eq "$_.tflite" -or $file -eq "$($_)_label_map.pb" }
    if ($isWanted) {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $target $file), $true)
      Write-Host "extracted $file"
    }
  }
}
finally {
  $zip.Dispose()
  Remove-Item $apk
}
Write-Host "Models are in $target - restart Gemini Live"
