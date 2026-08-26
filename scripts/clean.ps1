[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targets = @(
    ".vs",
    "src\LocalMediaTransfer.GUI\.vs",
    "src\LocalMediaTransfer.GUI\bin",
    "src\LocalMediaTransfer.GUI\obj",
    "src\Server\out",
    "src\Server\logs",
    "tests\LocalMediaTransfer.BoundaryTests\bin",
    "tests\LocalMediaTransfer.BoundaryTests\obj",
    "tests\LocalMediaTransfer.CoreTests\bin",
    "tests\LocalMediaTransfer.CoreTests\obj",
    "tests\LocalMediaTransfer.GuiSmoke\bin",
    "tests\LocalMediaTransfer.GuiSmoke\obj",
    "tests\LocalMediaTransfer.TestHarness\bin",
    "tests\LocalMediaTransfer.TestHarness\obj",
    "tools\LocalMediaTransfer.Benchmarks\bin",
    "tools\LocalMediaTransfer.Benchmarks\obj",
    "tools\LocalMediaTransfer.InnoSetup\staging"
)

foreach ($relativePath in $targets) {
    $target = [IO.Path]::GetFullPath((Join-Path $repoRoot $relativePath))
    if (-not $target.StartsWith(
            $repoRoot + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean outside the repository: $target"
    }

    if ((Test-Path -LiteralPath $target) -and
        $PSCmdlet.ShouldProcess($target, "Remove generated directory")) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

$resultFiles = @(
    Get-ChildItem (Join-Path $repoRoot "tests") -File -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -like "test_results_*.log" -or
            $_.Name -like "test_results_*.json" -or
            $_.Name -eq "test_results_out.txt"
        }
)
foreach ($file in $resultFiles) {
    if ($PSCmdlet.ShouldProcess($file.FullName, "Remove generated test result")) {
        Remove-Item -LiteralPath $file.FullName -Force
    }
}

Write-Host "Generated output cleanup complete." -ForegroundColor Green
Write-Host "Uploads, SQLite databases, vcpkg, and LocalAppData were not touched."
