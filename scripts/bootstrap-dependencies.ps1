[CmdletBinding()]
param(
    [string]$VcpkgRoot,
    [switch]$PreferVisualStudioTools,
    [switch]$Force,
    [ValidateRange(60, 7200)]
    [int]$RestoreTimeoutSeconds = 900
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($VcpkgRoot)) {
    $VcpkgRoot = Join-Path $repoRoot "vcpkg"
}
$manifest = Get-Content -Raw (Join-Path $repoRoot "vcpkg.json") |
    ConvertFrom-Json
$baseline = [string]$manifest.'builtin-baseline'

if (-not (Test-Path -LiteralPath $VcpkgRoot)) {
    Write-Host "Cloning vcpkg into $VcpkgRoot..."
    git clone https://github.com/microsoft/vcpkg.git $VcpkgRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to clone vcpkg."
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $VcpkgRoot ".git"))) {
    throw "VcpkgRoot is not a vcpkg Git checkout: $VcpkgRoot"
}

Write-Host "Selecting pinned vcpkg baseline $baseline..."
$safeRoot = $VcpkgRoot.Replace('\', '/')
$currentBaseline = git -c "safe.directory=$safeRoot" -C $VcpkgRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect the vcpkg checkout."
}

if ($currentBaseline.Trim() -ne $baseline) {
    git -c "safe.directory=$safeRoot" -C $VcpkgRoot fetch --depth 1 origin $baseline
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to fetch the pinned vcpkg baseline."
    }

    git -c "safe.directory=$safeRoot" -C $VcpkgRoot checkout --detach $baseline
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to check out the pinned vcpkg baseline."
    }
}

$vcpkgExe = Join-Path $VcpkgRoot "vcpkg.exe"
if (-not (Test-Path -LiteralPath $vcpkgExe)) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswhere) {
        $visualStudioPath = & $vswhere -latest -products * `
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -property installationPath
        $bundledVcpkg = Join-Path $visualStudioPath "VC\vcpkg\vcpkg.exe"
        if (Test-Path -LiteralPath $bundledVcpkg) {
            Copy-Item -LiteralPath $bundledVcpkg -Destination $vcpkgExe
        }
    }
}

if (-not (Test-Path -LiteralPath $vcpkgExe)) {
    & (Join-Path $VcpkgRoot "bootstrap-vcpkg.bat") -disableMetrics
    if ($LASTEXITCODE -ne 0) {
        throw "vcpkg bootstrap failed."
    }
}

$env:VCPKG_ROOT = $VcpkgRoot
$binaryCache = if ($env:VCPKG_DEFAULT_BINARY_CACHE) {
    $env:VCPKG_DEFAULT_BINARY_CACHE
}
else {
    Join-Path $env:LOCALAPPDATA "vcpkg\archives"
}
New-Item -ItemType Directory -Path $binaryCache -Force | Out-Null

function Get-VisualStudioCMakePath {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path -LiteralPath $vswhere)) {
        return $null
    }

    $visualStudioPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($visualStudioPath)) {
        return $null
    }

    $cmakePath = Join-Path $visualStudioPath "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin"
    $cmakeExe = Join-Path $cmakePath "cmake.exe"
    if (Test-Path -LiteralPath $cmakeExe) {
        return $cmakePath
    }

    return $null
}

function Get-VisualStudioNinjaPath {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path -LiteralPath $vswhere)) {
        return $null
    }

    $visualStudioPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($visualStudioPath)) {
        return $null
    }

    $ninjaPath = Join-Path $visualStudioPath "Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja"
    $ninjaExe = Join-Path $ninjaPath "ninja.exe"
    if (Test-Path -LiteralPath $ninjaExe) {
        return $ninjaPath
    }

    return $null
}

function Get-CommandDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $command -or [string]::IsNullOrWhiteSpace($command.Source)) {
        return $null
    }

    return Split-Path -Parent $command.Source
}

function Get-VcpkgToolPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Pattern
    )

    $toolsRoot = Join-Path $VcpkgRoot "downloads\tools"
    if (-not (Test-Path -LiteralPath $toolsRoot)) {
        return $null
    }

    $tool = Get-ChildItem -LiteralPath $toolsRoot -Directory -Filter $Pattern |
        Sort-Object -Property Name -Descending |
        Select-Object -First 1
    if ($null -eq $tool) {
        return $null
    }

    return $tool.FullName
}

function Test-Rc1107Failure {
    $buildtrees = Join-Path $VcpkgRoot "buildtrees"
    if (-not (Test-Path -LiteralPath $buildtrees)) {
        return $false
    }

    $logs = Get-ChildItem -LiteralPath $buildtrees -Recurse -File -Filter "*-out.log" -ErrorAction SilentlyContinue |
        Sort-Object -Property LastWriteTimeUtc -Descending |
        Select-Object -First 12
    foreach ($log in $logs) {
        if (Select-String -LiteralPath $log.FullName -Pattern "fatal error RC1107" -Quiet) {
            return $true
        }
    }

    return $false
}

function Test-VcpkgToolRestoreFailure {
    $buildtrees = Join-Path $VcpkgRoot "buildtrees"
    if (-not (Test-Path -LiteralPath $buildtrees)) {
        return $false
    }

    $patterns = @(
        "unable to detect the active compiler",
        "A suitable version of ninja was not found",
        "ninja.exe",
        "Error code: no such file or directory"
    )

    $logs = Get-ChildItem -LiteralPath $buildtrees -Recurse -File -Include "*.log" -ErrorAction SilentlyContinue |
        Sort-Object -Property LastWriteTimeUtc -Descending |
        Select-Object -First 20
    foreach ($log in $logs) {
        foreach ($pattern in $patterns) {
            if (Select-String -LiteralPath $log.FullName -Pattern $pattern -SimpleMatch -Quiet) {
                return $true
            }
        }
    }

    return $false
}

function Test-ManifestCurrent {
    $statusFile = Join-Path $repoRoot "vcpkg_installed\vcpkg\status"
    if (-not (Test-Path -LiteralPath $statusFile)) {
        return $false
    }

    $triplet = "x64-windows-static-md"
    $required = @($manifest.dependencies | ForEach-Object {
        if ($_ -is [string]) { $_ } else { $_.name }
    })
    if ($required.Count -eq 0) {
        return $false
    }

    # Parse the dpkg-style status file into package entries
    $statusText = [IO.File]::ReadAllText($statusFile)
    $entries = $statusText -split '(?m)^\s*$' | Where-Object { $_.Trim() -ne '' }

    $installed = @{}
    foreach ($entry in $entries) {
        $pkg = $null; $arch = $null; $st = $null
        foreach ($line in ($entry -split '\r?\n')) {
            if ($line -match '^Package:\s*(.+)$') { $pkg = $Matches[1].Trim() }
            if ($line -match '^Architecture:\s*(.+)$') { $arch = $Matches[1].Trim() }
            if ($line -match '^Status:\s*(.+)$') { $st = $Matches[1].Trim() }
        }
        if ($null -ne $pkg -and $arch -eq $triplet -and $st -eq 'install ok installed') {
            $installed[$pkg] = $true
        }
    }

    foreach ($dep in $required) {
        if (-not $installed.ContainsKey($dep)) {
            Write-Verbose "Manifest dependency not installed: $dep"
            return $false
        }
    }

    return $true
}

function Invoke-VcpkgInstall {
    param(
        [switch]$PreferVisualStudioTools,
        [int]$TimeoutSeconds = 300
    )

    $oldPath = $env:PATH
    $oldForceSystemBinaries = $env:VCPKG_FORCE_SYSTEM_BINARIES
    try {
        if ($PreferVisualStudioTools) {
            $toolPaths = @()
            $vsCMakePath = Get-VisualStudioCMakePath
            if (-not [string]::IsNullOrWhiteSpace($vsCMakePath)) {
                $toolPaths += $vsCMakePath
            }

            $vsNinjaPath = Get-VisualStudioNinjaPath
            if (-not [string]::IsNullOrWhiteSpace($vsNinjaPath)) {
                $toolPaths += $vsNinjaPath
            }

            foreach ($commandName in @("ninja.exe", "cmake.exe", "git.exe")) {
                $commandPath = Get-CommandDirectory -CommandName $commandName
                if (-not [string]::IsNullOrWhiteSpace($commandPath)) {
                    $toolPaths += $commandPath
                }
            }

            foreach ($pattern in @(
                "ninja-*-windows",
                "powershell-core-*-windows",
                "7zip-*-windows"
            )) {
                $toolPath = Get-VcpkgToolPath -Pattern $pattern
                if (-not [string]::IsNullOrWhiteSpace($toolPath)) {
                    $toolPaths += $toolPath
                }
            }

            $toolPaths = @($toolPaths | Where-Object {
                -not [string]::IsNullOrWhiteSpace($_)
            } | Select-Object -Unique)

            if ($toolPaths.Count -gt 0) {
                $env:PATH = ($toolPaths -join [IO.Path]::PathSeparator) +
                    [IO.Path]::PathSeparator +
                    $env:PATH
            }

            $env:VCPKG_FORCE_SYSTEM_BINARIES = "1"
            Write-Host "Using Visual Studio/system tools for MSVC resource compiler compatibility..."
        }

        $vcpkgArgs = @(
            "install",
            "--triplet", "x64-windows-static-md",
            "--x-manifest-root=$repoRoot"
        )
        Write-Host "Running: vcpkg $($vcpkgArgs -join ' ')"
        $proc = Start-Process -FilePath $vcpkgExe `
            -ArgumentList $vcpkgArgs `
            -NoNewWindow -PassThru
        $exited = $proc.WaitForExit($TimeoutSeconds * 1000)
        if (-not $exited) {
            Write-Warning "vcpkg install did not finish within $TimeoutSeconds seconds -- killing."
            try { $proc.Kill() } catch { }
            $null = $proc.WaitForExit(5000)
            return 1
        }

        # Complete the process wait before reading ExitCode. On Windows
        # PowerShell/.NET Framework, the timed overload can report that the
        # process exited before the Process object has refreshed all exit
        # information. Microsoft recommends following a successful timed wait
        # with the parameterless overload.
        $proc.WaitForExit()
        $proc.Refresh()
        $exitCode = [int]$proc.ExitCode
        Write-Host "vcpkg exited with code $exitCode."
        return $exitCode
    }
    finally {
        $env:PATH = $oldPath
        if ($null -eq $oldForceSystemBinaries) {
            Remove-Item Env:\VCPKG_FORCE_SYSTEM_BINARIES -ErrorAction SilentlyContinue
        }
        else {
            $env:VCPKG_FORCE_SYSTEM_BINARIES = $oldForceSystemBinaries
        }
    }
}

if (-not $Force -and (Test-ManifestCurrent)) {
    Write-Host "Dependencies already up-to-date (use -Force to re-restore)." -ForegroundColor Green
    exit 0
}

$restoreExitCode = Invoke-VcpkgInstall `
    -PreferVisualStudioTools:$PreferVisualStudioTools `
    -TimeoutSeconds $RestoreTimeoutSeconds
if ($restoreExitCode -ne 0 -and -not $PreferVisualStudioTools -and
    ((Test-Rc1107Failure) -or (Test-VcpkgToolRestoreFailure))) {
    Write-Warning "vcpkg restore failed during compiler/tool detection; retrying with Visual Studio/system tools."
    $restoreExitCode = Invoke-VcpkgInstall `
        -PreferVisualStudioTools `
        -TimeoutSeconds $RestoreTimeoutSeconds
}

if ($restoreExitCode -ne 0) {
    throw "vcpkg dependency restore failed."
}

Write-Host "Dependencies restored from vcpkg.json." -ForegroundColor Green
