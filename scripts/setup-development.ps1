[CmdletBinding()]
param([switch]$CheckOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$missing = [Collections.Generic.List[string]]::new()
foreach ($command in @('git', 'dotnet', 'node', 'npm.cmd')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        $missing.Add("Missing command: $command. Install Git, .NET 8 SDK and Node.js 24 LTS (npm 11), then reopen PowerShell.")
    }
}
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    $sdks = & dotnet --list-sdks
    if ($LASTEXITCODE -ne 0 -or -not (@($sdks | Where-Object { $_ -match '^(\d+)\.' -and [int]$Matches[1] -ge 8 }).Count)) { $missing.Add('Install .NET SDK 8 or later (the runtime alone is insufficient).') }
    $runtimes = & dotnet --list-runtimes
    if ($LASTEXITCODE -ne 0 -or -not ($runtimes -match '^Microsoft.NETCore.App 8\.')) { $missing.Add('Install the .NET 8 runtime to execute the net8.0 tests, even when building with a newer SDK.') }
}
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { $missing.Add('Node.js 24 LTS is required by the iOS project.') }
}
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    $npmVersion = & npm.cmd --version
    if ($LASTEXITCODE -ne 0 -or $npmVersion -notmatch '^11\.') { $missing.Add('Use npm 11 with the committed package-lock.json.') }
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $vswhere) {
    $vs = & $vswhere -latest -prerelease -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vs -or -not (Test-Path (Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'))) {
        $missing.Add('Install Visual Studio Desktop development with C++, including x64 MSVC, Windows SDK and CMake tools.')
    }
} else { $missing.Add('Install Visual Studio 2022 or later with Desktop development with C++.') }
if ($missing.Count) { throw ($missing -join "`n") }
Write-Host 'Prerequisites passed: Git, .NET SDK 8+ and runtime 8, Node 24/npm 11, MSVC and Visual Studio CMake.'
if ($CheckOnly) { return }
Push-Location $repoRoot
try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-dependencies.ps1 -PreferVisualStudioTools -RestoreTimeoutSeconds 2400
    if ($LASTEXITCODE -ne 0) { throw 'Native dependency restore failed.' }
    Push-Location .\src\LocalMediaTransfer.iOS
    try {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Locked npm dependency restore failed.' }
    } finally { Pop-Location }
    & powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -Target validate
    if ($LASTEXITCODE -ne 0) { throw 'Repository validation failed.' }
} finally { Pop-Location }
Write-Host 'Dependencies ready. Run .\scripts\verify.ps1 -Target all to build and test; .NET restores during the builds.'
