[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Version,
    [switch]$Check,
    [switch]$Status
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Check -and $Status) {
    throw "Use either -Check or -Status."
}
if (($Check -or $Status) -and -not [string]::IsNullOrWhiteSpace($Version)) {
    throw "Use -Version to update files, or -Check/-Status to inspect them."
}
if (-not ($Check -or $Status) -and [string]::IsNullOrWhiteSpace($Version)) {
    throw "Supply -Version MAJOR.MINOR.PATCH, or use -Check or -Status."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$versionFile = Join-Path $repoRoot "VERSION"
if ($Check -or $Status) {
    if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) {
        throw "VERSION is missing."
    }
    $Version = (Get-Content -LiteralPath $versionFile -Raw).Trim()
}

if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw "Version must use numeric MAJOR.MINOR.PATCH format, for example 2.0.1."
}

$rules = @(
    @{
        Path = "VERSION"
        Pattern = '^\d+\.\d+\.\d+\r?\n?$'
        Replacement = "{VERSION}`r`n"
    },
    @{
        Path = "src/Server/CMakeLists.txt"
        Pattern = 'project\(LocalMediaTransferServer VERSION \d+\.\d+\.\d+ LANGUAGES CXX\)'
        Replacement = 'project(LocalMediaTransferServer VERSION {VERSION} LANGUAGES CXX)'
    },
    @{
        Path = "src/Server/include/common/Version.hpp"
        Pattern = 'inline constexpr const char\* Version = "\d+\.\d+\.\d+";'
        Replacement = 'inline constexpr const char* Version = "{VERSION}";'
    },
    @{
        Path = "src/LocalMediaTransfer.GUI/LocalMediaTransfer.GUI.csproj"
        Pattern = '<Version>\d+\.\d+\.\d+</Version>'
        Replacement = '<Version>{VERSION}</Version>'
    },
    @{
        Path = "src/LocalMediaTransfer.GUI/app.manifest"
        Pattern = 'assemblyIdentity version="\d+\.\d+\.\d+\.\d+"'
        Replacement = 'assemblyIdentity version="{VERSION}.0"'
    },
    @{
        Path = "src/LocalMediaTransfer.GUI/Features/About/AboutPage.xaml"
        Pattern = 'Text="Version \d+\.\d+\.\d+"'
        Replacement = 'Text="Version {VERSION}"'
    },
    @{
        Path = "src/LocalMediaTransfer.Mobile/app.json"
        Pattern = '(?m)^    "version": "\d+\.\d+\.\d+",(?=\r?$)'
        Replacement = '    "version": "{VERSION}",'
    },
    @{
        Path = "src/LocalMediaTransfer.Mobile/package.json"
        Pattern = '(?m)^  "version": "\d+\.\d+\.\d+",(?=\r?$)'
        Replacement = '  "version": "{VERSION}",'
    },
    @{
        Path = "src/LocalMediaTransfer.Mobile/package-lock.json"
        Pattern = '\A(\{\r?\n  "name": "localmediatransfer\.ios",\r?\n  "version": ")\d+\.\d+\.\d+("\,)'
        Replacement = '${1}{VERSION}${2}'
    },
    @{
        Path = "src/LocalMediaTransfer.Mobile/package-lock.json"
        Pattern = '("packages": \{\r?\n    "": \{\r?\n      "name": "localmediatransfer\.ios",\r?\n      "version": ")\d+\.\d+\.\d+("\,)'
        Replacement = '${1}{VERSION}${2}'
    },
    @{
        Path = "src/LocalMediaTransfer.Mobile/modules/local-media-transfer-native/package.json"
        Pattern = '(?m)^  "version": "\d+\.\d+\.\d+",(?=\r?$)'
        Replacement = '  "version": "{VERSION}",'
    },
    @{
        Path = "src/LocalMediaTransfer.Mobile/modules/local-media-transfer-native/ios/LocalMediaTransferNative.podspec"
        Pattern = "s\.version\s+=\s+'\d+\.\d+\.\d+'"
        Replacement = "s.version        = '{VERSION}'"
    },
    @{
        Path = "src/LocalMediaTransfer.Mobile/src/version.ts"
        Pattern = "MOBILE_APP_VERSION = '\d+\.\d+\.\d+'"
        Replacement = "MOBILE_APP_VERSION = '{VERSION}'"
    },
    @{
        Path = "vcpkg.json"
        Pattern = '"version-string": "\d+\.\d+\.\d+"'
        Replacement = '"version-string": "{VERSION}"'
    },
    @{
        Path = "tools/LocalMediaTransfer.Benchmarks/Program.cs"
        Pattern = 'private const string ProductVersion = "\d+\.\d+\.\d+";'
        Replacement = 'private const string ProductVersion = "{VERSION}";'
    }
)

$planned = [System.Collections.Generic.List[object]]::new()
foreach ($rule in $rules) {
    $path = Join-Path $repoRoot $rule.Path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Version target is missing: $($rule.Path)"
    }

    $content = [IO.File]::ReadAllText($path)
    $matches = [regex]::Matches($content, $rule.Pattern)
    if ($matches.Count -ne 1) {
        throw "Expected one version field in $($rule.Path), found $($matches.Count)."
    }

    $replacement = $rule.Replacement.Replace('{VERSION}', $Version)
    $updated = [regex]::Replace($content, $rule.Pattern, $replacement)
    $planned.Add([pscustomobject]@{
        Path = $path
        RelativePath = $rule.Path
        Original = $content
        Updated = $updated
    })
}

$drift = @($planned | Where-Object { $_.Original -ne $_.Updated })
if ($Check -or $Status) {
    if ($drift.Count -gt 0) {
        $paths = ($drift.RelativePath | Sort-Object -Unique) -join ", "
        throw "Product version differs from VERSION ($Version): $paths"
    }
    Write-Host "All $($rules.Count) product version fields match VERSION ($Version)." -ForegroundColor Green
    if ($Status) {
        Write-Host "VERSION is the release number; commits after a tag remain development changes until the next release."
        if (Get-Command git -ErrorAction SilentlyContinue) {
            $lastTag = (& git -C $repoRoot describe --tags --abbrev=0 --match 'v[0-9]*' 2>$null | Select-Object -First 1)
            if ($lastTag) {
                $commitsSinceTag = (& git -C $repoRoot rev-list --count "$lastTag..HEAD" 2>$null | Select-Object -First 1)
                if ($commitsSinceTag -match '^\d+$') {
                    Write-Host "Latest reachable local tag: $lastTag; commits since tag: $commitsSinceTag."
                }
            }
        }
    }
    return
}

$utf8 = [Text.UTF8Encoding]::new($false)
foreach ($change in $drift) {
    [IO.File]::WriteAllText($change.Path, $change.Updated, $utf8)
    Write-Host "Updated $($change.RelativePath)"
}
Write-Host "Product version is now $Version." -ForegroundColor Green
