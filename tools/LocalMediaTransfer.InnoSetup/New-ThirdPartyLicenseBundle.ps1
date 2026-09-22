[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$StageRoot
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

function New-Directory {
    param([Parameter(Mandatory)][string]$Path)

    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Get-NuGetRoot {
    if (-not [string]::IsNullOrWhiteSpace($env:NUGET_PACKAGES)) {
        return $env:NUGET_PACKAGES
    }

    return Join-Path $env:USERPROFILE ".nuget\packages"
}

function Get-SafeName {
    param([Parameter(Mandatory)][string]$Value)

    return $Value -replace '[^A-Za-z0-9._-]', '_'
}

function Get-NormalizedTextSha256 {
    param([Parameter(Mandatory)][string]$Path)

    $text = [IO.File]::ReadAllText($Path).
        Replace("`r`n", "`n").
        Replace("`r", "`n")
    $utf8 = New-Object Text.UTF8Encoding($false)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString(
            $sha256.ComputeHash($utf8.GetBytes($text))
        )).Replace('-', '')
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-XmlChildText {
    param(
        [Parameter(Mandatory)]$Parent,
        [Parameter(Mandatory)][string]$Name
    )

    $node = $Parent.SelectSingleNode("*[local-name()='$Name']")
    if ($null -eq $node) {
        return ""
    }
    return [string]$node.InnerText
}

function Get-XmlChildAttribute {
    param(
        [Parameter(Mandatory)]$Parent,
        [Parameter(Mandatory)][string]$ChildName,
        [Parameter(Mandatory)][string]$AttributeName
    )

    $node = $Parent.SelectSingleNode("*[local-name()='$ChildName']")
    if ($null -eq $node -or $null -eq $node.Attributes[$AttributeName]) {
        return ""
    }
    return [string]$node.Attributes[$AttributeName].Value
}

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$resolvedStageRoot = (Resolve-Path -LiteralPath $StageRoot).Path
$bundleRoot = Join-Path $resolvedStageRoot "THIRD_PARTY_LICENSES"

if (Test-Path -LiteralPath $bundleRoot) {
    $resolvedBundleRoot = (Resolve-Path -LiteralPath $bundleRoot).Path
    $stagePrefix = $resolvedStageRoot.TrimEnd('\') + '\'
    if (-not $resolvedBundleRoot.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace a license bundle outside the staging directory: $resolvedBundleRoot"
    }
    Remove-Item -LiteralPath $resolvedBundleRoot -Recurse -Force
}

New-Directory -Path $bundleRoot

$summarySource = Join-Path $resolvedRepoRoot "THIRD_PARTY_NOTICES.md"
Assert-File -Path $summarySource -Description "Third-party notice inventory"
Copy-Item -LiteralPath $summarySource -Destination (Join-Path $bundleRoot "INVENTORY.md")

# Native dependencies statically linked into the C++ server. The vcpkg
# copyright files contain the upstream license and copyright text selected by
# the exact manifest baseline and triplet used by this build.
$nativeShare = Join-Path $resolvedRepoRoot `
    "src\Server\out\build\x64-release\vcpkg_installed\x64-windows-static-md\share"
Assert-Directory -Path $nativeShare -Description "Release vcpkg share directory"
$nativeRoot = Join-Path $bundleRoot "native-vcpkg"
New-Directory -Path $nativeRoot

$nativePackages = @()
foreach ($packageDirectory in @(Get-ChildItem -LiteralPath $nativeShare -Directory | Sort-Object Name)) {
    $copyright = Join-Path $packageDirectory.FullName "copyright"
    if (-not (Test-Path -LiteralPath $copyright -PathType Leaf)) {
        continue
    }

    $destination = Join-Path $nativeRoot (Get-SafeName -Value $packageDirectory.Name)
    New-Directory -Path $destination
    Copy-Item -LiteralPath $copyright -Destination (Join-Path $destination "LICENSE.txt")
    $nativePackages += $packageDirectory.Name
}

if ($nativePackages.Count -eq 0) {
    throw "No native dependency license files were collected."
}

# NuGet runtime closure recorded by dotnet publish. Each package gets its exact
# nuspec metadata plus every bundled license/copyright/NOTICE file. Packages
# using the SPDX MIT expression without a bundled text receive the standard MIT
# permission text together with the author/copyright metadata from the nuspec.
$depsFile = Join-Path $resolvedStageRoot "LocalMediaTransfer.GUI.deps.json"
Assert-File -Path $depsFile -Description "Published GUI dependency manifest"
$deps = Get-Content -LiteralPath $depsFile -Raw | ConvertFrom-Json
$nugetRoot = Get-NuGetRoot
Assert-Directory -Path $nugetRoot -Description "NuGet package cache"
$nugetBundleRoot = Join-Path $bundleRoot "nuget-runtime"
New-Directory -Path $nugetBundleRoot

$mitPermissionText = @'
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'@

$nugetPackages = @()
foreach ($library in @($deps.libraries.PSObject.Properties | Sort-Object Name)) {
    if ([string]$library.Value.type -ne "package") {
        continue
    }

    $libraryName = [string]$library.Name
    $packagePath = [string]$library.Value.path
    if ([string]::IsNullOrWhiteSpace($packagePath)) {
        throw "NuGet package path is missing for $libraryName."
    }

    $packageRoot = Join-Path $nugetRoot ($packagePath -replace '/', '\')
    Assert-Directory -Path $packageRoot -Description "NuGet package $libraryName"
    $destination = Join-Path $nugetBundleRoot (Get-SafeName -Value $libraryName)
    New-Directory -Path $destination

    $nuspec = Get-ChildItem -LiteralPath $packageRoot -Filter "*.nuspec" -File |
        Select-Object -First 1
    if ($null -eq $nuspec) {
        throw "NuGet metadata not found for $libraryName."
    }
    Copy-Item -LiteralPath $nuspec.FullName -Destination (Join-Path $destination $nuspec.Name)

    [xml]$nuspecXml = Get-Content -LiteralPath $nuspec.FullName -Raw
    $metadata = $nuspecXml.package.metadata
    $licenseType = Get-XmlChildAttribute -Parent $metadata `
        -ChildName "license" -AttributeName "type"
    $licenseValue = Get-XmlChildText -Parent $metadata -Name "license"
    $authors = Get-XmlChildText -Parent $metadata -Name "authors"
    $copyright = Get-XmlChildText -Parent $metadata -Name "copyright"
    $projectUrl = Get-XmlChildText -Parent $metadata -Name "projectUrl"
    $repositoryUrl = Get-XmlChildAttribute -Parent $metadata `
        -ChildName "repository" -AttributeName "url"
    $repositoryCommit = Get-XmlChildAttribute -Parent $metadata `
        -ChildName "repository" -AttributeName "commit"

    $metadataLines = @(
        "Package: $libraryName",
        "Authors: $authors",
        "Copyright: $copyright",
        "License type: $licenseType",
        "License: $licenseValue",
        "Project URL: $projectUrl",
        "Repository: $repositoryUrl",
        "Repository commit: $repositoryCommit"
    )
    Set-Content -LiteralPath (Join-Path $destination "PACKAGE-METADATA.txt") `
        -Value $metadataLines -Encoding UTF8

    $licenseCandidates = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
        Where-Object {
            $_.Name -match '(?i)^(license|licence|notice|copying|copyright|third[-_. ]party)'
        })

    foreach ($candidate in $licenseCandidates) {
        $relativeName = $candidate.FullName.Substring($packageRoot.Length).
            TrimStart([char[]]"\/")
        $destinationName = $relativeName -replace '[\\/:*?"<>|]', '__'
        Copy-Item -LiteralPath $candidate.FullName `
            -Destination (Join-Path $destination $destinationName)
    }

    if ($licenseCandidates.Count -eq 0) {
        if ($licenseType -ne "expression" -or $licenseValue -ne "MIT") {
            throw "No bundled license text was found for $libraryName ($licenseType $licenseValue)."
        }

        $notice = if (-not [string]::IsNullOrWhiteSpace($copyright)) {
            $copyright
        }
        else {
            "Authors named by the NuGet package: $authors"
        }
        $mitText = "MIT License`r`n`r`n$notice`r`n`r`n$mitPermissionText"
        Set-Content -LiteralPath (Join-Path $destination "LICENSE-MIT.txt") `
            -Value $mitText -Encoding UTF8
    }

    $nugetPackages += $libraryName
}

if ($nugetPackages.Count -eq 0) {
    throw "No NuGet runtime dependency licenses were collected."
}

# Vendored browser assets shipped inside the server's static directory.
$browserRoot = Join-Path $bundleRoot "browser-assets"
$browserLicenses = @(
    @{
        Name = "font-awesome-7.2.0"
        Source = "src\Server\static\icons\fontawesome\LICENSE.txt"
        Destination = "LICENSE.txt"
        Sha256 = "20C6F40715A567C97B80F6944BEB8BB325835CAB47EA7DCAB89EE3B8E077ECED"
    },
    @{
        Name = "google-sans"
        Source = "src\Server\static\font\Google_Sans\OFL.txt"
        Destination = "OFL.txt"
        Sha256 = $null
    },
    @{
        Name = "google-sans"
        Source = "src\Server\static\font\Google_Sans\README.txt"
        Destination = "README.txt"
        Sha256 = $null
    },
    @{
        Name = "hash-wasm"
        Source = "src\Server\static\vendor\hash-wasm\LICENSE"
        Destination = "LICENSE.txt"
        Sha256 = $null
    }
)

foreach ($entry in $browserLicenses) {
    $source = Join-Path $resolvedRepoRoot $entry.Source
    Assert-File -Path $source -Description "Browser dependency license"
    if (-not [string]::IsNullOrWhiteSpace([string]$entry.Sha256)) {
        # Git normalizes text to LF in the index, while Windows worktrees may
        # materialize CRLF. Verify the license text independently of that
        # checkout detail so local and CI packaging enforce the same pin.
        $actualHash = Get-NormalizedTextSha256 -Path $source
        if ($actualHash -ne [string]$entry.Sha256) {
            throw "Pinned license checksum mismatch for $($entry.Name)."
        }
    }

    $destination = Join-Path $browserRoot $entry.Name
    New-Directory -Path $destination
    Copy-Item -LiteralPath $source -Destination (Join-Path $destination $entry.Destination)
}

# The installer executable contains the Inno Setup runtime. Preserve the local
# compiler's license alongside the product dependency notices.
$innoLicenseCandidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\license.txt",
    "${env:ProgramFiles}\Inno Setup 6\license.txt"
)
$innoLicense = $innoLicenseCandidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
if ($null -ne $innoLicense) {
    $installerRoot = Join-Path $bundleRoot "installer"
    New-Directory -Path $installerRoot
    Copy-Item -LiteralPath $innoLicense `
        -Destination (Join-Path $installerRoot "Inno-Setup-LICENSE.txt")
}

$manifestPath = Join-Path $bundleRoot "MANIFEST.sha256"
$manifestLines = @(Get-ChildItem -LiteralPath $bundleRoot -Recurse -File |
    Where-Object { $_.FullName -ne $manifestPath } |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($bundleRoot.Length).
            TrimStart([char[]]"\/").Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relative"
    })
Set-Content -LiteralPath $manifestPath -Value $manifestLines -Encoding ASCII

Write-Host "Collected licenses for $($nativePackages.Count) native and $($nugetPackages.Count) NuGet runtime packages."
Write-Host "Third-party license bundle: $bundleRoot"
