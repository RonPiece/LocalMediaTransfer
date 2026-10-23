<# Verify staged browser/receiver identity and write a local build manifest. #>
param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$StageRoot,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$Installer
)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'src\Server\static'))
$stagedRoot = Join-Path $StageRoot 'server\static'
$appSource = Get-Content -LiteralPath (Join-Path $sourceRoot 'js\app.js') -Raw
$versionMatch = [regex]::Match($appSource, 'assetVersion\s*=\s*''([^'']+)''')
if (-not $versionMatch.Success) { throw 'Browser frontend version was not found.' }
$frontendVersion = $versionMatch.Groups[1].Value
$html = Get-Content -LiteralPath (Join-Path $sourceRoot 'index.html') -Raw
foreach ($assetVersion in [regex]::Matches($html, '/static/[^"\s]+\?v=([^"\s]+)')) {
    if ($assetVersion.Groups[1].Value -ne $frontendVersion) { throw 'Browser asset version keys differ.' }
}
$sourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse)
$stagedFiles = @(Get-ChildItem -LiteralPath $stagedRoot -File -Recurse)
if ($sourceFiles.Count -ne $stagedFiles.Count) { throw 'Packaged browser asset inventory differs from source.' }
$assets = @($sourceFiles | Sort-Object FullName | ForEach-Object {
    $relativeAsset = $_.FullName.Substring($sourceRoot.Length + 1)
    $packagedAsset = Join-Path $stagedRoot $relativeAsset
    $sourceHash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -ne (Get-FileHash -LiteralPath $packagedAsset -Algorithm SHA256).Hash.ToLowerInvariant()) {
        throw "Stale packaged browser asset: $relativeAsset"
    }
    [pscustomobject]@{ file = $relativeAsset.Replace('\', '/'); sha256 = $sourceHash }
})
$receiverHash = (Get-FileHash -LiteralPath (Join-Path $RepoRoot 'src\Server\out\build\x64-release\bin\LocalMediaTransferServer.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($receiverHash -ne (Get-FileHash -LiteralPath (Join-Path $StageRoot 'server\LocalMediaTransferServer.exe') -Algorithm SHA256).Hash.ToLowerInvariant()) {
    throw 'Packaged receiver differs from the Release output.'
}
Push-Location $RepoRoot
try {
    $manifest = [ordered]@{
        frontendVersion = $frontendVersion
        sourceCommit = (git rev-parse HEAD)
        branch = (git branch --show-current)
        dirty = [bool](git status --porcelain)
        receiverSha256 = $receiverHash
        installer = [IO.Path]::GetFileName($Installer)
        installerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
        assets = $assets
    }
}
finally { Pop-Location }
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Host "Verified $($assets.Count) browser assets, frontend $frontendVersion and the Release receiver."
