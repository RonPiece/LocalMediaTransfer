$ErrorActionPreference = "Stop"

Write-Host "Running frontend tests..."
$testFiles = Get-ChildItem (Join-Path $PSScriptRoot "frontend") -Filter "*.test.cjs" |
    Sort-Object Name |
    Select-Object -ExpandProperty FullName

node --test $testFiles
$code = $LASTEXITCODE

if ($code -ne 0) {
    Write-Host "Frontend tests failed (exit code $code)." -ForegroundColor Red
    exit $code
}

Write-Host "Frontend tests passed." -ForegroundColor Green
