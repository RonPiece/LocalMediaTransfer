[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$workflow = Get-Content -Raw (Join-Path $repo '.github/workflows/windows-release.yml')
if ($workflow -notmatch 'needs: native-ios' -or
    $workflow -notmatch 'needs: \[build, provenance\]' -or
    $workflow -notmatch 'actions/attest-build-provenance@') {
    throw 'Release must depend on the native compiler gate and artifact provenance.'
}
if ($workflow -notmatch '(?s)verify\.ps1 -Target all.*?name: Build release artifacts.*?verify\.ps1 -Target server-release-tests -ServerExecutable.*?verify\.ps1 -Target stress-tests -ServerExecutable.*?id: artifacts' -or
    $workflow -match 'continue-on-error: true') {
    throw 'Release must pass full verification and packaged-server integration/stress before uploading artifacts.'
}
if ($workflow -notmatch '(?s)permissions:\s+contents: read.*?  publish:.*?permissions:\s+contents: write') {
    throw 'Release build/publication permission separation is missing.'
}
foreach ($action in [regex]::Matches($workflow, 'uses: ([^\r\n]+)')) {
    if ($action.Groups[1].Value.Trim() -eq './.github/workflows/ios-unsigned-ipa.yml') { continue }
    if ($action.Groups[1].Value -notmatch '^actions/[a-z-]+@[a-f0-9]{40} # v\d+$') {
        throw 'Release action is not pinned to a full commit.'
    }
}
$publishStart = $workflow.IndexOf('  publish:')
$publish = $workflow.Substring($publishStart)
if ($publish -match 'actions/checkout|actions/cache|setup-dotnet' -or
    $workflow -notmatch 'persist-credentials: false' -or
    $publish -notmatch 'artifact-ids: \$\{\{ needs.build.outputs.artifact-id \}\}') {
    throw 'Privileged publication must consume only this build artifact without checkout/cache.'
}
$runStart = $publish.IndexOf('        run: |')
if ($runStart -lt 0) { throw 'Missing publisher script.' }
$runLines = ($publish.Substring($runStart) -split "`n") | Select-Object -Skip 1
$scriptText = ($runLines | ForEach-Object { $_ -replace '^          ', '' }) -join "`n"
$scriptBlock = [scriptblock]::Create($scriptText)

# The actual workflow script runs against tiny synthetic artifacts. The local
# function shadows gh, so these tests cannot create a GitHub release.
function gh { $script:published = @($args); $global:LASTEXITCODE = 0 }
$testBase = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'LocalMediaTransfer.Tests'))
$testRoot = Join-Path $testBase ([Guid]::NewGuid().ToString('N'))
$oldVersion = $env:RELEASE_VERSION
$oldRef = $env:GITHUB_REF_NAME
$oldExitCode = Get-Variable LASTEXITCODE -Scope Global -ValueOnly -ErrorAction SilentlyContinue
if ($null -eq $oldExitCode) { $oldExitCode = 0 }
New-Item -ItemType Directory -Path (Join-Path $testRoot 'release-assets') -Force | Out-Null
Push-Location $testRoot
try {
    $names = @('LocalMediaTransfer-Setup-2.0.0-x64.exe', 'LocalMediaTransfer-2.0.0-windows-x64-portable.zip')
    foreach ($name in $names) { [IO.File]::WriteAllText((Join-Path "$testRoot/release-assets" $name), 'synthetic') }
    $valid = @($names | ForEach-Object { "$( (Get-FileHash -LiteralPath "release-assets/$_" -Algorithm SHA256).Hash )  $_" })
    $scenarios = @(
        @{ Name='valid draft'; Lines=$valid; Version='2.0.0'; Ref='v2.0.0'; Accept=$true },
        @{ Name='missing checksum'; Lines=@($valid[0]); Accept=$false },
        @{ Name='duplicate checksum'; Lines=@($valid[0],$valid[0]); Accept=$false },
        @{ Name='wrong checksum'; Lines=@(('0' * 64) + '  ' + $names[0],$valid[1]); Accept=$false },
        @{ Name='path traversal'; Lines=@(('0' * 64) + '  ../outside.exe',$valid[1]); Accept=$false },
        @{ Name='tag mismatch'; Lines=$valid; Ref='v2.0.1'; Accept=$false },
        @{ Name='invalid version'; Lines=$valid; Version='../../outside'; Accept=$false }
    )
    foreach ($scenario in $scenarios) {
        $env:RELEASE_VERSION = if ($scenario['Version']) { $scenario['Version'] } else { '2.0.0' }
        $env:GITHUB_REF_NAME = if ($scenario['Ref']) { $scenario['Ref'] } else { 'v2.0.0' }
        $scenario.Lines | Set-Content -LiteralPath 'release-assets/SHA256SUMS.txt'
        $script:published = @()
        $failed = $false
        try { & $scriptBlock } catch { $failed = $true }
        if ($scenario.Accept) {
            if ($failed -or $script:published -notcontains '--draft' -or
                $script:published -notcontains '--verify-tag') { throw 'Valid artifacts were not drafted correctly.' }
        } elseif (!$failed -or $script:published.Count -ne 0) { throw "Unsafe publication accepted: $($scenario.Name)" }
        Write-Host "PASS release $($scenario.Name)"
    }
} finally {
    Pop-Location
    $env:RELEASE_VERSION = $oldVersion
    $env:GITHUB_REF_NAME = $oldRef
    $global:LASTEXITCODE = $oldExitCode
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (!$resolved.StartsWith($testBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Unsafe test cleanup path.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
