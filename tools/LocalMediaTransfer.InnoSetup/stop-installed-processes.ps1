param([Parameter(Mandatory = $true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'InstalledProcessShutdown.cs')
    $guiStopped = [LocalMediaTransfer.Installer.InstalledProcessShutdown]::StopInstalled(
        (Join-Path $InstallDirectory 'LocalMediaTransfer.GUI.exe'))
    $serverStopped = [LocalMediaTransfer.Installer.InstalledProcessShutdown]::StopInstalled(
        (Join-Path $InstallDirectory 'server\LocalMediaTransferServer.exe'))
    if (-not $guiStopped -or -not $serverStopped) { exit 1 }
    exit 0
} catch { exit 1 }
