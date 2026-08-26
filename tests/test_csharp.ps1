$ErrorActionPreference = "Stop"

$projects = @(
    (Join-Path $PSScriptRoot "LocalMediaTransfer.CoreTests\LocalMediaTransfer.CoreTests.csproj"),
    (Join-Path $PSScriptRoot "LocalMediaTransfer.WindowsClientTests\LocalMediaTransfer.WindowsClientTests.csproj"),
    (Join-Path $PSScriptRoot "LocalMediaTransfer.NativeWindowsAcceptanceTests\LocalMediaTransfer.NativeWindowsAcceptanceTests.csproj")
)

foreach ($project in $projects) {
    dotnet run --project $project -c Debug
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
exit 0
