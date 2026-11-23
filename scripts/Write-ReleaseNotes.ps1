<#
.SYNOPSIS
  Writes the notes of a GitHub release: the highlights, then what is new, fixed and faster since the
  release before it.

.DESCRIPTION
  The highlights are the tag's own message: tag a release with `git tag -a vX.Y.Z -m "<highlights>"`
  and they lead the notes; a lightweight tag has none. Below them, the user-facing commits since the
  previous tag, grouped by their conventional type (feat, fix, perf, and any marked `!`), with the
  commits that only touch development, tooling or the release itself left out. GitHub's own
  --generate-notes lists merged pull requests only, and every change here goes straight to main.

.PARAMETER Tag
  The release's tag, such as v0.3.2.

.PARAMETER OutFile
  Where the Markdown is written.

.EXAMPLE
  pwsh scripts\Write-ReleaseNotes.ps1 -Tag v0.3.2 -OutFile build\release-notes.md
#>
param(
    [Parameter(Mandatory)]
    [string] $Tag,
    [Parameter(Mandatory)]
    [string] $OutFile
)

$ErrorActionPreference = 'Stop'
$repository = 'avi12/gemini-live-for-windows'

# Scopes no user sees: development, tooling, dependencies and the release machinery
$internalScopes = @('dev', 'lint', 'deps', 'build', 'release', 'ci', 'test', 'tests', 'refactor')

$sections = [ordered] @{
    Breaking = [Collections.Generic.List[string]]::new()
    New = [Collections.Generic.List[string]]::new()
    Fixed = [Collections.Generic.List[string]]::new()
    Faster = [Collections.Generic.List[string]]::new()
}
$sectionOfType = @{
    feat = 'New'
    fix = 'Fixed'
    perf = 'Faster'
}

$previous = git describe --tags --abbrev=0 "$Tag^" 2>$null
$range = if ($LASTEXITCODE -eq 0) { "$previous..$Tag" } else { $Tag }
$subjects = git log --no-merges --format=%s $range
if ($LASTEXITCODE) { throw "Could not read the commits of $range" }

foreach ($subject in $subjects) {
    $match = [regex]::Match($subject, '^(?<type>\w+)(\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<text>.+)$')
    if (-not $match.Success) { continue }

    $type = $match.Groups['type'].Value
    $isBreaking = $match.Groups['breaking'].Success
    $isInternal = $internalScopes -contains $match.Groups['scope'].Value
    $section = if ($isBreaking) { 'Breaking' } else { $sectionOfType[$type] }
    if (-not $section -or ($isInternal -and -not $isBreaking)) { continue }

    $text = $match.Groups['text'].Value
    $sections[$section].Add($text.Substring(0, 1).ToUpper() + $text.Substring(1))
}

$lines = [Collections.Generic.List[string]]::new()
$isAnnotated = (git cat-file -t $Tag) -eq 'tag'
if ($isAnnotated) {
    $highlights = (git tag -l --format='%(contents)' $Tag | Out-String).Trim()
    # A message that only repeats the release's name, as the earlier tags have, is no highlight
    $isOnlyTheName = $highlights -match '^Gemini Live [\d.]+$'
    if ($highlights -and -not $isOnlyTheName) {
        $lines.Add('## Highlights')
        $lines.Add('')
        $lines.Add($highlights)
        $lines.Add('')
    }
}

foreach ($name in $sections.Keys) {
    $entries = $sections[$name]
    if ($entries.Count -eq 0) { continue }

    $lines.Add("## $name")
    $lines.Add('')
    foreach ($entry in $entries) { $lines.Add("- $entry") }
    $lines.Add('')
}

if ($previous) {
    $lines.Add("**Full Changelog**: https://github.com/$repository/compare/$previous...$Tag")
}

New-Item -ItemType Directory -Force (Split-Path $OutFile) | Out-Null
Set-Content -Path $OutFile -Value ($lines -join "`n") -Encoding utf8NoBOM
