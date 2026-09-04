<#
.SYNOPSIS
    Builds the Local Media Transfer Windows installer.

.DESCRIPTION
    Creates a clean staging folder, publishes the WinUI GUI into it, copies the
    C++ server plus runtime DLLs under the layout expected by the GUI, and then
    compiles setup.iss with Inno Setup 6.

    Installed layout:
      Program Files\Local Media Transfer\LocalMediaTransfer.GUI.exe
      Program Files\Local Media Transfer\Assets\...
      Program Files\Local Media Transfer\server\LocalMediaTransferServer.exe
      Program Files\Local Media Transfer\server\static\...

.PARAMETER SkipBuild
    Reuse existing Release build output and only restage/compile the installer.

.PARAMETER Version
    Override the version used by the installer filename and metadata.

.PARAMETER KeepStaging
    Keep the staging folder after a successful build for inspection.

.PARAMETER ReleaseArtifacts
    Create a portable ZIP and SHA256SUMS.txt beside the installer.
#>

param(
    [switch]$SkipBuild,
    [string]$Version,
    [switch]$KeepStaging,
    [switch]$StageOnly,
    [switch]$ReleaseArtifacts
)

$ErrorActionPreference = "Stop"

function New-CleanDirectory {
    param([Parameter(Mandatory)][string]$Path)

    if (Test-Path -LiteralPath $Path) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force
        }
        catch {
            throw "Could not clean installer staging folder: $Path. Close any Local Media Transfer app launched from the staging folder, then run the installer build again. Original error: $($_.Exception.Message)"
        }
    }
    New-Item -ItemType Directory -Path $Path | Out-Null
}

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

function Copy-WinUIResources {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$DestinationRoot
    )

    Assert-Directory -Path $SourceRoot -Description "WinUI resource source directory"

    $requiredRootFiles = @(
        "LocalMediaTransfer.GUI.pri",
        "App.xbf",
        "MainWindow.xbf"
    )

    foreach ($fileName in $requiredRootFiles) {
        $source = Join-Path $SourceRoot $fileName
        Assert-File -Path $source -Description "WinUI resource $fileName"
        Copy-Item -LiteralPath $source -Destination (Join-Path $DestinationRoot $fileName) -Force
    }

    $sourceFeatures = Join-Path $SourceRoot "Features"
    Assert-Directory -Path $sourceFeatures -Description "WinUI feature resources"

    $destinationFeatures = Join-Path $DestinationRoot "Features"
    New-Item -ItemType Directory -Path $destinationFeatures -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceFeatures "*") -Destination $destinationFeatures -Recurse -Force

    $requiredFeatureViews = @(
        "About\AboutPage.xbf",
        "Activity\ActivityPage.xbf",
        "Dashboard\DashboardPage.xbf",
        "Send\SendPage.xbf",
        "Network\NetworkPage.xbf",
        "Security\SecurityPage.xbf",
        "Settings\SettingsPage.xbf"
    )

    foreach ($fileName in $requiredFeatureViews) {
        Assert-File -Path (Join-Path $destinationFeatures $fileName) -Description "Staged WinUI feature resource $fileName"
    }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$VersionFile = Join-Path $RepoRoot "VERSION"
if ([string]::IsNullOrWhiteSpace($Version)) {
    Assert-File -Path $VersionFile -Description "Repository version file"
    $Version = (Get-Content -LiteralPath $VersionFile -Raw).Trim()
}
if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw "Version must use MAJOR.MINOR.PATCH numeric format, for example 2.0.1."
}
$OutputDir = Join-Path $ScriptDir "output"
$StagingRoot = Join-Path $ScriptDir "staging"
$AppStage = Join-Path $StagingRoot "app"
$ServerStage = Join-Path $AppStage "server"
$SetupScript = Join-Path $ScriptDir "setup.iss"

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

Write-Host "======================================================================"
Write-Host "Local Media Transfer Installer Builder"
Write-Host "======================================================================"
Write-Host "Repository Root: $RepoRoot"
Write-Host "Output Directory: $OutputDir"
Write-Host "Staging Directory: $AppStage"
Write-Host "Version: $Version"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host ""

if (-not $SkipBuild) {
    Write-Host "[1/4] Building C++ server (Release)..." -ForegroundColor Cyan
    $ServerBuildScript = Join-Path $RepoRoot "src\Server\build.bat"
    Assert-File -Path $ServerBuildScript -Description "Server build script"

    Push-Location $RepoRoot
    try {
        & cmd /c "`"$ServerBuildScript`" Release"
        if ($LASTEXITCODE -ne 0) {
            throw "C++ server build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
    Write-Host "OK: Server build succeeded" -ForegroundColor Green
    Write-Host ""
}

$ServerBin = Join-Path $RepoRoot "src\Server\out\build\x64-release\bin"
$ServerExe = Join-Path $ServerBin "LocalMediaTransferServer.exe"
$StaticDir = Join-Path $RepoRoot "src\Server\static"
$GuiProject = Join-Path $RepoRoot "src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj"
$GuiReleaseRuntime = Join-Path $RepoRoot "src\LocalMediaTransfer.GUI\bin\x64\Release\net8.0-windows10.0.19041.0\win-x64"
$IconFile = Join-Path $RepoRoot "src\LocalMediaTransfer.GUI\Assets\Icons\AppIcon.ico"
$LicenseFile = Join-Path $RepoRoot "LICENSE"
$ThirdPartyNotices = Join-Path $RepoRoot "THIRD_PARTY_NOTICES.md"

Assert-Directory -Path $ServerBin -Description "Release server bin directory"
Assert-File -Path $ServerExe -Description "Release server executable"
Assert-Directory -Path $StaticDir -Description "Server static assets"
Assert-File -Path $GuiProject -Description "GUI project"
Assert-File -Path $IconFile -Description "Application icon"
Assert-File -Path $LicenseFile -Description "Apache license"
Assert-File -Path $ThirdPartyNotices -Description "Third-party notices"

Write-Host "[2/4] Creating clean installer staging folder..." -ForegroundColor Cyan
New-CleanDirectory -Path $StagingRoot
New-Item -ItemType Directory -Path $AppStage -Force | Out-Null
New-Item -ItemType Directory -Path $ServerStage -Force | Out-Null
Write-Host "OK: Staging folder prepared" -ForegroundColor Green
Write-Host ""

if (-not $SkipBuild) {
    Write-Host "[3/4] Publishing WinUI GUI (Release, x64)..." -ForegroundColor Cyan
    dotnet publish $GuiProject `
        -c Release `
        -p:Platform=x64 `
        -r win-x64 `
        -p:PublishDir="$AppStage\" `
        -p:WindowsPackageType=None `
        -p:WindowsAppSDKSelfContained=false `
        -p:PublishSingleFile=false `
        -p:PublishTrimmed=false

    if ($LASTEXITCODE -ne 0) {
        throw "GUI publish failed with exit code $LASTEXITCODE"
    }
    Write-Host "OK: GUI publish succeeded" -ForegroundColor Green
}
else {
    Write-Host "[3/4] GUI publish skipped; copying existing Release publish output..." -ForegroundColor Yellow
    $ExistingGuiExe = Get-ChildItem `
        -Path (Join-Path $RepoRoot "src\LocalMediaTransfer.GUI\bin\x64\Release") `
        -Recurse `
        -Filter "LocalMediaTransfer.GUI.exe" `
        -File `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $ExistingGuiExe) {
        throw "No existing Release GUI executable found. Run without -SkipBuild first."
    }

    Copy-Item -Path (Join-Path $ExistingGuiExe.DirectoryName "*") -Destination $AppStage -Recurse -Force
    Write-Host "Copied GUI output from: $($ExistingGuiExe.DirectoryName)"
}

$GuiExe = Join-Path $AppStage "LocalMediaTransfer.GUI.exe"
Assert-File -Path $GuiExe -Description "Staged GUI executable"
Copy-WinUIResources -SourceRoot $GuiReleaseRuntime -DestinationRoot $AppStage
Assert-File -Path (Join-Path $AppStage "LocalMediaTransfer.GUI.pri") -Description "Staged WinUI PRI resource"
Assert-File -Path (Join-Path $AppStage "MainWindow.xbf") -Description "Staged MainWindow XAML resource"
$stagedSymbols = @(Get-ChildItem -LiteralPath $AppStage -Recurse -Filter "*.pdb" -File)
foreach ($symbol in $stagedSymbols) {
    Remove-Item -LiteralPath $symbol.FullName -Force
}
$RootStatic = Join-Path $AppStage "static"
if (Test-Path -LiteralPath $RootStatic) {
    Remove-Item -LiteralPath $RootStatic -Recurse -Force
}

$AssetsStage = Join-Path $AppStage "Assets"
New-Item -ItemType Directory -Path $AssetsStage -Force | Out-Null
Copy-Item `
    -Path (Join-Path $RepoRoot "src\LocalMediaTransfer.GUI\Assets\*") `
    -Destination $AssetsStage `
    -Recurse `
    -Force
Assert-File -Path (Join-Path $AppStage "Assets\Icons\AppIcon.ico") -Description "Staged application icon"
Copy-Item -LiteralPath $LicenseFile -Destination (Join-Path $AppStage "LICENSE.txt")
Copy-Item -LiteralPath $ThirdPartyNotices -Destination (Join-Path $AppStage "THIRD_PARTY_NOTICES.md")

Write-Host "Copying server runtime files..."
Copy-Item -Path (Join-Path $ServerBin "*") -Destination $ServerStage -Recurse -Force
Assert-File -Path (Join-Path $ServerStage "LocalMediaTransferServer.exe") -Description "Staged server executable"
Assert-File -Path (Join-Path $ServerStage "static\index.html") -Description "Staged web UI"
Write-Host "OK: Server runtime staged" -ForegroundColor Green
Write-Host ""

$LicenseBundleScript = Join-Path $ScriptDir "New-ThirdPartyLicenseBundle.ps1"
Assert-File -Path $LicenseBundleScript -Description "Third-party license bundle script"
& powershell -NoProfile -ExecutionPolicy Bypass -File $LicenseBundleScript `
    -RepoRoot $RepoRoot `
    -StageRoot $AppStage
if ($LASTEXITCODE -ne 0) {
    throw "Third-party license bundle generation failed with exit code $LASTEXITCODE"
}
Assert-File `
    -Path (Join-Path $AppStage "THIRD_PARTY_LICENSES\MANIFEST.sha256") `
    -Description "Third-party license manifest"
Write-Host "OK: Third-party license bundle generated" -ForegroundColor Green
Write-Host ""

if ($StageOnly) {
    Write-Host "Installer staging validation passed." -ForegroundColor Green
    Write-Host "Staged GUI: $GuiExe"
    Write-Host "Staged server: $(Join-Path $ServerStage 'LocalMediaTransferServer.exe')"
    Write-Host "Staged web UI: $(Join-Path $ServerStage 'static\index.html')"
    exit 0
}

Write-Host "[4/4] Compiling Inno Setup installer..." -ForegroundColor Cyan
$InnoSetupPaths = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)

$IsccPath = $null
foreach ($Candidate in $InnoSetupPaths) {
    if ($Candidate -and (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
        $IsccPath = $Candidate
        break
    }
}

if (-not $IsccPath) {
    throw "ISCC.exe not found. Install Inno Setup 6 or update tools\LocalMediaTransfer.InnoSetup\build.ps1."
}

Write-Host "Using Inno Setup compiler: $IsccPath"

$SetupContent = Get-Content -LiteralPath $SetupScript -Raw
$SetupContent = $SetupContent -replace '#define MyAppVersion "[^"]*"', "#define MyAppVersion `"$Version`""
$TempSetupScript = Join-Path $env:TEMP ("lmt_setup_{0}.iss" -f ([guid]::NewGuid().ToString("N")))

try {
    Set-Content -LiteralPath $TempSetupScript -Value $SetupContent -Encoding UTF8
    & $IsccPath /D"StagingDir=$AppStage" /D"OutputDir=$OutputDir" $TempSetupScript
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup compilation failed with exit code $LASTEXITCODE"
    }
}
finally {
    Remove-Item -LiteralPath $TempSetupScript -Force -ErrorAction SilentlyContinue
}

$OutputExe = Join-Path $OutputDir "LocalMediaTransfer-Setup-$Version-x64.exe"
Assert-File -Path $OutputExe -Description "Installer output"
$SizeMB = [math]::Round(((Get-Item -LiteralPath $OutputExe).Length / 1MB), 2)

if ($ReleaseArtifacts) {
    $PortableZip = Join-Path $OutputDir "LocalMediaTransfer-$Version-windows-x64-portable.zip"
    $ChecksumFile = Join-Path $OutputDir "SHA256SUMS.txt"
    if (Test-Path -LiteralPath $PortableZip) {
        Remove-Item -LiteralPath $PortableZip -Force
    }
    if (Test-Path -LiteralPath $ChecksumFile) {
        Remove-Item -LiteralPath $ChecksumFile -Force
    }

    Write-Host "Creating portable ZIP..."
    Compress-Archive `
        -Path (Join-Path $AppStage "*") `
        -DestinationPath $PortableZip `
        -CompressionLevel Optimal
    Assert-File -Path $PortableZip -Description "Portable ZIP"

    $ChecksumLines = @($OutputExe, $PortableZip | ForEach-Object {
        $artifact = Get-Item -LiteralPath $_
        $hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).
            Hash.ToLowerInvariant()
        "$hash  $($artifact.Name)"
    })
    Set-Content -LiteralPath $ChecksumFile -Value $ChecksumLines -Encoding ASCII
    Assert-File -Path $ChecksumFile -Description "Release checksum manifest"
    Write-Host "Portable ZIP: $PortableZip"
    Write-Host "Checksums: $ChecksumFile"
}

if (-not $KeepStaging) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
}

Write-Host ""
Write-Host "======================================================================"
Write-Host "Build complete!" -ForegroundColor Green
Write-Host "Installer: $OutputExe ($SizeMB MB)"
Write-Host "======================================================================"
