[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Version,
    [switch]$Check
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Check -and -not [string]::IsNullOrWhiteSpace($Version)) {
    throw "Use either -Version to update files or -Check to verify them, not both."
}
if (-not $Check -and [string]::IsNullOrWhiteSpace($Version)) {
    throw "Supply -Version MAJOR.MINOR.PATCH, or use -Check."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$versionFile = Join-Path $repoRoot "VERSION"
if ($Check) {
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
        Path = "src/LocalMediaTransfer.iOS/app.json"
        Pattern = '(?m)^    "version": "\d+\.\d+\.\d+",(?=\r?$)'
        Replacement = '    "version": "{VERSION}",'
    },
    @{
        Path = "src/LocalMediaTransfer.iOS/package.json"
        Pattern = '(?m)^  "version": "\d+\.\d+\.\d+",(?=\r?$)'
        Replacement = '  "version": "{VERSION}",'
    },
    @{
        Path = "src/LocalMediaTransfer.iOS/package-lock.json"
        Pattern = '\A(\{\r?\n  "name": "localmediatransfer\.ios",\r?\n  "version": ")\d+\.\d+\.\d+("\,)'
        Replacement = '${1}{VERSION}${2}'
    },
    @{
        Path = "src/LocalMediaTransfer.iOS/package-lock.json"
        Pattern = '("packages": \{\r?\n    "": \{\r?\n      "name": "localmediatransfer\.ios",\r?\n      "version": ")\d+\.\d+\.\d+("\,)'
        Replacement = '${1}{VERSION}${2}'
    },
    @{
        Path = "src/LocalMediaTransfer.iOS/modules/local-media-transfer-native/package.json"
        Pattern = '(?m)^  "version": "\d+\.\d+\.\d+",(?=\r?$)'
        Replacement = '  "version": "{VERSION}",'
    },
    @{
        Path = "src/LocalMediaTransfer.iOS/modules/local-media-transfer-native/ios/LocalMediaTransferNative.podspec"
        Pattern = "s\.version\s+=\s+'\d+\.\d+\.\d+'"
        Replacement = "s.version        = '{VERSION}'"
    },
    @{
        Path = "src/LocalMediaTransfer.iOS/src/version.ts"
        Pattern = "IOS_APP_VERSION = '\d+\.\d+\.\d+'"
        Replacement = "IOS_APP_VERSION = '{VERSION}'"
    },
    @{
        Path = "vcpkg.json"
        Pattern = '"version-string": "\d+\.\d+\.\d+"'
        Replacement = '"version-string": "{VERSION}"'
    },
    @{
        Path = "tools/LocalMediaTransfer.InnoSetup/setup.iss"
        Pattern = '#define MyAppVersion "\d+\.\d+\.\d+"'
        Replacement = '#define MyAppVersion "{VERSION}"'
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
if ($Check) {
    if ($drift.Count -gt 0) {
        $paths = ($drift.RelativePath | Sort-Object -Unique) -join ", "
        throw "Product version differs from VERSION ($Version): $paths"
    }
    Write-Host "All product version fields match VERSION ($Version)." -ForegroundColor Green
    return
}

$utf8 = [Text.UTF8Encoding]::new($false)
foreach ($change in $drift) {
    [IO.File]::WriteAllText($change.Path, $change.Updated, $utf8)
    Write-Host "Updated $($change.RelativePath)"
}
Write-Host "Product version is now $Version." -ForegroundColor Green
