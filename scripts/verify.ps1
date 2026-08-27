[CmdletBinding()]
param(
    [ValidateSet(
        "validate",
        "server-debug",
        "server-release",
        "gui",
        "gui-test",
        "server-tests",
        "frontend-tests",
        "ios-tests",
        "csharp-tests",
        "gui-smoke",
        "all"
    )]
    [string]$Target = "all",
    [switch]$SkipLargeBoundaryTests
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Invoke-Target {
    param([Parameter(Mandatory)][string]$Name)

    switch ($Name) {
        "validate" {
            Invoke-Checked "Repository validation" {
                powershell -NoProfile -ExecutionPolicy Bypass -File `
                    (Join-Path $repoRoot "scripts\validate-repository.ps1")
            }
        }
        "server-debug" {
            Invoke-Checked "C++ server Debug build" {
                & (Join-Path $repoRoot "src\Server\build.bat") Debug
            }
        }
        "server-release" {
            Invoke-Checked "C++ server Release build" {
                & (Join-Path $repoRoot "src\Server\build.bat") Release
            }
        }
        "gui" {
            Invoke-Checked "WinUI Debug x64 build" {
                dotnet build `
                    (Join-Path $repoRoot "src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj") `
                    -c Debug -p:Platform=x64
            }
        }
        "gui-test" {
            Invoke-Checked "WinUI test-environment Debug x64 build" {
                dotnet build `
                    (Join-Path $repoRoot "src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj") `
                    -c Debug -p:Platform=x64 -p:LmtEnvironment=Test
            }
        }
        "server-tests" {
            Invoke-Checked "Isolated server integration suite" {
                $arguments = @(
                    "run",
                    "--project",
                    (Join-Path $repoRoot "tests\LocalMediaTransfer.TestHarness"),
                    "-c",
                    "Release"
                )
                if ($SkipLargeBoundaryTests) {
                    $arguments += @("--", "--skip-large-boundary-tests")
                }
                & dotnet @arguments
            }
        }
        "frontend-tests" {
            Invoke-Checked "Frontend unit tests" {
                powershell -NoProfile -ExecutionPolicy Bypass -File `
                    (Join-Path $repoRoot "tests\test_frontend.ps1")
            }
        }
        "ios-tests" {
            $iosDirectory = Join-Path $repoRoot "src\LocalMediaTransfer.iOS"
            Push-Location $iosDirectory
            try {
                Invoke-Checked "Expo SDK dependency compatibility" {
                    npx expo install --check
                }
                Invoke-Checked "iOS Jest tests" {
                    npm test -- --runInBand
                }
                Invoke-Checked "iOS TypeScript" {
                    npx tsc --noEmit
                }
                Invoke-Checked "iOS ESLint" {
                    npm run lint
                }
            }
            finally {
                Pop-Location
            }
        }
        "csharp-tests" {
            Invoke-Checked "C# core and Windows client tests" {
                powershell -NoProfile -ExecutionPolicy Bypass -File `
                    (Join-Path $repoRoot "tests\test_csharp.ps1")
            }
        }
        "gui-smoke" {
            Invoke-Checked "WinUI lifecycle smoke" {
                dotnet run --project `
                    (Join-Path $repoRoot "tests\LocalMediaTransfer.GuiSmoke") `
                    -c Release
            }
        }
        default {
            throw "Unknown verification target: $Name"
        }
    }
}

Push-Location $repoRoot
try {
    if ($Target -eq "all") {
        @(
            "validate",
            "server-debug",
            "server-release",
            "server-tests",
            "frontend-tests",
            "ios-tests",
            "csharp-tests",
            "gui",
            "gui-test"
        ) | ForEach-Object { Invoke-Target $_ }
    }
    else {
        Invoke-Target $Target
    }
}
finally {
    Pop-Location
}

Write-Host "`nVerification target '$Target' passed." -ForegroundColor Green
