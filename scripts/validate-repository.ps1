[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$failures = [System.Collections.Generic.List[string]]::new()

Push-Location $repoRoot
try {
    & (Join-Path $repoRoot "scripts\set-version.ps1") -Check

    $trackedFiles = @(git ls-files)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to enumerate tracked files."
    }
    if ($trackedFiles -contains "CHANGELOG_DEV.md") {
        $failures.Add(
            "Private development changelog must remain local and untracked: CHANGELOG_DEV.md")
    }

    $tracked = @(
        $trackedFiles
        git ls-files --others --exclude-standard
    ) | Sort-Object -Unique
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to enumerate tracked files."
    }

    $generatedPatterns = @(
        '(^|/)(bin|obj|out|build|artifacts|staging|node_modules|\.vs)(/|$)',
        '\.(exe|dll|pdb|ilk|lib|obj|db|db-shm|db-wal|log|msi|msix)$'
    )
    foreach ($file in $tracked) {
        if ($generatedPatterns | Where-Object { $file -match $_ }) {
            $failures.Add("Generated output is tracked: $file")
        }
    }

    $textExtensions = @(
        ".bat", ".cmd", ".cs", ".csproj", ".css", ".html", ".iss",
        ".js", ".json", ".md", ".ps1", ".slnx", ".toml", ".xaml",
        ".xml", ".yaml", ".yml"
    )
    foreach ($file in $tracked) {
        $path = Join-Path $repoRoot $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            $textExtensions -notcontains [IO.Path]::GetExtension($file)) {
            continue
        }

        $content = [IO.File]::ReadAllText($path)
        if ($content -match
            '(?i)[A-Z]:[\\/]+Users[\\/]+[A-Za-z0-9][A-Za-z0-9._-]*') {
            $failures.Add("Personal absolute path found: $file")
        }
    }

    $requiredFrontendAssets = @(
        "src/Server/static/index.html",
        "src/Server/static/style.css",
        "src/Server/static/js/app.js",
        "src/Server/static/vendor/hash-wasm/sha256.umd.min.js",
        "src/Server/static/vendor/hash-wasm/LICENSE"
    )
    foreach ($asset in $requiredFrontendAssets) {
        if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $asset))) {
            $failures.Add("Required frontend asset is missing: $asset")
        }
    }

    $indexHtml = [IO.File]::ReadAllText(
        (Join-Path $repoRoot "src\Server\static\index.html"))
    if ($indexHtml -match '<(?:script|link)\b[^>]+(?:src|href)=["'']https?://') {
        $failures.Add("Frontend entrypoint contains a runtime CDN dependency.")
    }

    $installerScript = [IO.File]::ReadAllText(
        (Join-Path $repoRoot "tools\LocalMediaTransfer.InnoSetup\setup.iss"))
    foreach ($requiredFirewallOption in @(
        "dir=in",
        "protocol=TCP",
        "protocol=UDP",
        "localport=45892",
        "profile=private",
        "remoteip=localsubnet"
    )) {
        if ($installerScript.IndexOf(
                $requiredFirewallOption,
                [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            $failures.Add(
                "Installer firewall rule is missing: $requiredFirewallOption")
        }
    }

    $dashboardXaml = [IO.File]::ReadAllText(
        (Join-Path $repoRoot "src\LocalMediaTransfer.GUI\Features\Dashboard\DashboardPage.xaml"))
    if ($dashboardXaml -match '<Expander\b[^>]*Browser transfer') {
        $failures.Add(
            "Browser transfer must use an anchored flyout, not a layout-expanding Expander.")
    }
    foreach ($requiredReceiveSurface in @(
        'x:Name="BrowserTransferFlyout"',
        'x:Name="ConnectionUrl"',
        'x:Name="BrowserLinkStatusText"',
        'x:Name="BrowserQrCodeImage"',
        'Content="Create browser link"',
        'IsTextSelectionEnabled="True"',
        'TextWrapping="Wrap"'
    )) {
        if ($dashboardXaml.IndexOf(
                $requiredReceiveSurface,
                [StringComparison]::Ordinal) -lt 0) {
            $failures.Add(
                "Receive browser-transfer surface is missing: $requiredReceiveSurface")
        }
    }

    $mainWindowXaml = [IO.File]::ReadAllText(
        (Join-Path $repoRoot "src\LocalMediaTransfer.GUI\MainWindow.xaml"))
    if ($mainWindowXaml.IndexOf(
            'Content="Activity" Tag="Activity"',
            [StringComparison]::Ordinal) -lt 0) {
        $failures.Add("WinUI navigation is missing the Activity page.")
    }

    $markdownFiles = $tracked | Where-Object { $_ -like "*.md" }
    foreach ($file in $markdownFiles) {
        $path = Join-Path $repoRoot $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            continue
        }
        $content = [IO.File]::ReadAllText($path)
        foreach ($match in [regex]::Matches(
            $content,
            '\[[^\]]+\]\((?!https?://|mailto:|#)([^)]+)\)')) {
            $target = [Uri]::UnescapeDataString(
                $match.Groups[1].Value.Split('#')[0])
            if ([string]::IsNullOrWhiteSpace($target)) {
                continue
            }
            $resolved = Join-Path (Split-Path -Parent $path) $target
            if (-not (Test-Path -LiteralPath $resolved)) {
                $failures.Add("Broken Markdown link in ${file}: $target")
            }
        }
    }
}
finally {
    Pop-Location
}

if ($failures.Count -gt 0) {
    $failures | Sort-Object -Unique | ForEach-Object {
        Write-Error $_ -ErrorAction Continue
    }
    exit 1
}

Write-Host "Repository validation passed." -ForegroundColor Green
