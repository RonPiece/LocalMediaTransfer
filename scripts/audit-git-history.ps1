[CmdletBinding()]
param(
    [string]$GitleaksPath,
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $stamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmssZ")
    $OutputDirectory = Join-Path $env:TEMP "LocalMediaTransfer.PublicationAudit\$stamp"
}
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
if (-not $outputRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warning "The audit output is outside the temporary directory. Keep it out of Git and protect it as sensitive."
}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($GitleaksPath)) {
    $onPath = Get-Command gitleaks -ErrorAction SilentlyContinue
    if ($onPath) {
        $GitleaksPath = $onPath.Source
    }
    else {
        $downloads = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
        $downloaded = Get-ChildItem -Path $downloads -Filter gitleaks.exe -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName |
            Select-Object -First 1
        if ($downloaded) {
            $GitleaksPath = $downloaded.FullName
        }
    }
}

if ([string]::IsNullOrWhiteSpace($GitleaksPath) -or
    -not (Test-Path -LiteralPath $GitleaksPath -PathType Leaf)) {
    throw "gitleaks.exe was not found. Extract the Windows archive, then pass -GitleaksPath with the full executable path."
}

$gitleaksExe = (Resolve-Path -LiteralPath $GitleaksPath).Path
$gitleaksVersion = (& $gitleaksExe version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitleaksVersion)) {
    throw "Unable to determine the Gitleaks version from '$gitleaksExe'."
}
if ($gitleaksVersion -match '(?<!\d)8\.30\.1(?!\d)') {
    throw "Gitleaks 8.30.1 is not accepted because its published binaries can silently miss secrets. Use 8.30.0 or a later verified fixed release."
}

$gitleaksReport = Join-Path $outputRoot "gitleaks-report.json"
$riskyPathReport = Join-Path $outputRoot "risky-history-paths.txt"
$refReport = Join-Path $outputRoot "refs.txt"

Push-Location $repoRoot
try {
    Write-Host "Gitleaks: $gitleaksExe ($gitleaksVersion)"
    Write-Host "Audit output: $outputRoot"
    & $gitleaksExe git `
        --no-banner `
        --redact `
        --report-format json `
        --report-path $gitleaksReport `
        --log-opts="--all" `
        $repoRoot
    $gitleaksExit = $LASTEXITCODE

    $riskyPattern = '(?i)(^|/)(diff\.txt|[^/]+\.(exe|dll|msi|msix|pfx|p12|pem|key|crt|cer))$'
    $risky = @(
        git rev-list --objects --all |
            ForEach-Object {
                $parts = $_ -split ' ', 2
                if ($parts.Count -eq 2 -and $parts[1] -match $riskyPattern) {
                    $parts[1]
                }
            } |
            Sort-Object -Unique
    )
    [IO.File]::WriteAllLines($riskyPathReport, $risky, [Text.UTF8Encoding]::new($false))

    $refs = @(git for-each-ref --format='%(refname) %(objectname)')
    [IO.File]::WriteAllLines($refReport, $refs, [Text.UTF8Encoding]::new($false))
}
finally {
    Pop-Location
}

Write-Host ""
if ($gitleaksExit -eq 0) {
    Write-Host "Gitleaks found no secret candidates in reachable Git history." -ForegroundColor Green
}
elseif ($gitleaksExit -eq 1) {
    Write-Error "Gitleaks found one or more candidates. Review the redacted report before publication." -ErrorAction Continue
}
else {
    Write-Error "Gitleaks failed with exit code $gitleaksExit." -ErrorAction Continue
}

if ($risky.Count -gt 0) {
    Write-Warning "Reachable history contains $($risky.Count) unique risky binary/certificate/patch path(s). Review $riskyPathReport."
}
else {
    Write-Host "No risky binary/certificate/patch paths were found in reachable object names." -ForegroundColor Green
}

Write-Host "Ref inventory: $refReport"
Write-Host "Gitleaks report: $gitleaksReport"
Write-Host "This scan does not detect every personal path, private media item, or sensitive artifact."

if ($gitleaksExit -ne 0 -or $risky.Count -gt 0) {
    exit 1
}
