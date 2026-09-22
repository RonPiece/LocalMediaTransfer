<#
.SYNOPSIS
    Independently verifies the Windows GitHub Release artifact set.

.DESCRIPTION
    Recomputes the published SHA-256 checksums, extracts the portable ZIP,
    verifies every generated third-party license manifest entry, and rejects
    PDB files in both the installer staging tree and portable archive.
#>

[CmdletBinding()]
param(
    [string]$Version,
    [string]$ArtifactsDirectory,
    [string]$StagingDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-File {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description not found: $Path"
    }
}

function Assert-Directory {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Description not found: $Path"
    }
}

function Assert-NoPdbFiles {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Description
    )

    $symbols = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter "*.pdb")
    if ($symbols.Count -ne 0) {
        $relativePaths = $symbols | ForEach-Object {
            $_.FullName.Substring($Root.Length).TrimStart([char[]]"\/")
        }
        throw "$Description contains PDB files: $($relativePaths -join ', ')"
    }
}

function Test-LicenseManifest {
    param([Parameter(Mandatory)][string]$ApplicationRoot)

    $licenseRoot = Join-Path $ApplicationRoot "THIRD_PARTY_LICENSES"
    $manifestPath = Join-Path $licenseRoot "MANIFEST.sha256"
    Assert-Directory -Path $licenseRoot -Description "Third-party license directory"
    Assert-File -Path $manifestPath -Description "Third-party license manifest"

    $entries = @{}
    foreach ($line in @(Get-Content -LiteralPath $manifestPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        if ($line -notmatch '^(?<Hash>[0-9a-fA-F]{64})  (?<Path>.+)$') {
            throw "Malformed third-party license manifest line: $line"
        }

        $relativePath = $Matches.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
        if ([IO.Path]::IsPathRooted($relativePath) -or
            $relativePath.Split([char[]]"\/") -contains "..") {
            throw "Unsafe third-party license manifest path: $($Matches.Path)"
        }
        if ($entries.ContainsKey($relativePath)) {
            throw "Duplicate third-party license manifest path: $($Matches.Path)"
        }
        $entries[$relativePath] = $Matches.Hash.ToLowerInvariant()
    }

    if ($entries.Count -eq 0) {
        throw "Third-party license manifest is empty."
    }

    $licenseFiles = @(Get-ChildItem -LiteralPath $licenseRoot -Recurse -File |
        Where-Object { $_.FullName -ne $manifestPath })
    if ($licenseFiles.Count -ne $entries.Count) {
        throw "Third-party license manifest count does not match the bundled files."
    }

    foreach ($relativePath in $entries.Keys) {
        $filePath = Join-Path $licenseRoot $relativePath
        Assert-File -Path $filePath -Description "Manifest-listed license file"
        $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).
            Hash.ToLowerInvariant()
        if ($actualHash -ne $entries[$relativePath]) {
            throw "Third-party license hash mismatch: $relativePath"
        }
    }
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..")).Path

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content -LiteralPath (Join-Path $repositoryRoot "VERSION") -Raw).Trim()
}
if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw "Version must use MAJOR.MINOR.PATCH numeric format."
}
if ([string]::IsNullOrWhiteSpace($ArtifactsDirectory)) {
    $ArtifactsDirectory = Join-Path $scriptDirectory "output"
}
if ([string]::IsNullOrWhiteSpace($StagingDirectory)) {
    $StagingDirectory = Join-Path $scriptDirectory "staging\app"
}

$ArtifactsDirectory = (Resolve-Path $ArtifactsDirectory).Path
$StagingDirectory = (Resolve-Path $StagingDirectory).Path
$installerName = "LocalMediaTransfer-Setup-$Version-x64.exe"
$portableName = "LocalMediaTransfer-$Version-windows-x64-portable.zip"
$installerPath = Join-Path $ArtifactsDirectory $installerName
$portablePath = Join-Path $ArtifactsDirectory $portableName
$checksumsPath = Join-Path $ArtifactsDirectory "SHA256SUMS.txt"

Assert-File -Path $installerPath -Description "Windows installer"
Assert-File -Path $portablePath -Description "Portable ZIP"
Assert-File -Path $checksumsPath -Description "Release checksum file"

$checksumEntries = @{}
foreach ($line in @(Get-Content -LiteralPath $checksumsPath)) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }
    if ($line -notmatch '^(?<Hash>[0-9a-fA-F]{64})  (?<Name>[^\\/]+)$') {
        throw "Malformed SHA256SUMS.txt line: $line"
    }
    if ($checksumEntries.ContainsKey($Matches.Name)) {
        throw "Duplicate checksum entry: $($Matches.Name)"
    }
    $checksumEntries[$Matches.Name] = $Matches.Hash.ToLowerInvariant()
}

$expectedNames = @($installerName, $portableName)
if ($checksumEntries.Count -ne $expectedNames.Count) {
    throw "SHA256SUMS.txt must contain exactly the installer and portable ZIP."
}
foreach ($name in $expectedNames) {
    if (-not $checksumEntries.ContainsKey($name)) {
        throw "Missing checksum entry: $name"
    }
    $actualHash = (Get-FileHash -LiteralPath (Join-Path $ArtifactsDirectory $name) `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $checksumEntries[$name]) {
        throw "Release artifact checksum mismatch: $name"
    }
}

Assert-NoPdbFiles -Root $StagingDirectory -Description "Installer staging tree"
Test-LicenseManifest -ApplicationRoot $StagingDirectory

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).
    TrimEnd([IO.Path]::DirectorySeparatorChar)
$extractRoot = Join-Path $temporaryRoot ("LocalMediaTransfer.ReleaseVerify.{0}" -f `
    [guid]::NewGuid().ToString("N"))
$resolvedExtractRoot = [IO.Path]::GetFullPath($extractRoot)
$requiredPrefix = $temporaryRoot + [IO.Path]::DirectorySeparatorChar
if (-not $resolvedExtractRoot.StartsWith($requiredPrefix,
        [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a ZIP extraction directory outside the system temporary directory."
}

try {
    New-Item -ItemType Directory -Path $resolvedExtractRoot | Out-Null
    Expand-Archive -LiteralPath $portablePath -DestinationPath $resolvedExtractRoot

    Assert-File -Path (Join-Path $resolvedExtractRoot "LocalMediaTransfer.GUI.exe") `
        -Description "Portable GUI executable"
    Assert-File -Path (Join-Path $resolvedExtractRoot "server\LocalMediaTransferServer.exe") `
        -Description "Portable server executable"
    Assert-NoPdbFiles -Root $resolvedExtractRoot -Description "Portable ZIP"
    Test-LicenseManifest -ApplicationRoot $resolvedExtractRoot
}
finally {
    if (Test-Path -LiteralPath $resolvedExtractRoot) {
        Remove-Item -LiteralPath $resolvedExtractRoot -Recurse -Force
    }
}

Write-Host "Verified release checksums, ZIP extraction, license manifests, and PDB exclusion." -ForegroundColor Green
