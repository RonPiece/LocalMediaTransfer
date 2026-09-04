# Local Media Transfer Inno Setup Installer

This folder builds the Windows installer for the GUI application. The headless
server is included as a private runtime component and is launched by the GUI.

## Prerequisites

- Visual Studio 2022 with the x64 C++ toolchain.
- .NET 8 SDK.
- Inno Setup 6 installed at one of the standard paths, for example:
  `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`.

## Build

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\LocalMediaTransfer.InnoSetup\build.ps1
```

Optional version override:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\LocalMediaTransfer.InnoSetup\build.ps1 -Version "2.0.1"
```

Reuse existing Release outputs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\LocalMediaTransfer.InnoSetup\build.ps1 -SkipBuild
```

Keep the temporary staging folder for inspection:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\LocalMediaTransfer.InnoSetup\build.ps1 -KeepStaging
```

Create the complete GitHub Release artifact set:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\tools\LocalMediaTransfer.InnoSetup\build.ps1 `
  -ReleaseArtifacts
```

This produces the installer EXE, a portable x64 ZIP, and `SHA256SUMS.txt`.
Both Windows artifacts include a generated `THIRD_PARTY_LICENSES` bundle from
the exact vcpkg and NuGet runtime dependency closure used by the build.

Validate the complete install layout without invoking Inno Setup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\tools\LocalMediaTransfer.InnoSetup\build.ps1 -StageOnly
```

The installer is written to:

```text
tools\LocalMediaTransfer.InnoSetup\output\LocalMediaTransfer-Setup-<version>-x64.exe
tools\LocalMediaTransfer.InnoSetup\output\LocalMediaTransfer-<version>-windows-x64-portable.zip
tools\LocalMediaTransfer.InnoSetup\output\SHA256SUMS.txt
```

## Installed Layout

The installer intentionally installs the GUI at the app root because shortcuts
launch the GUI, not the headless server.

```text
Program Files\Local Media Transfer\
  LocalMediaTransfer.GUI.exe
  Assets\
  server\
    LocalMediaTransferServer.exe
    static\
      index.html
      ...
```

Native third-party libraries are linked with the `x64-windows-static-md`
triplet. The server still uses the dynamic Microsoft C/C++ runtime supplied by
Windows/Visual Studio runtime installation.

This layout matches `ServerManager.FindServerPath()`:

```text
AppContext.BaseDirectory\server\LocalMediaTransferServer.exe
```

The server working directory is the `server` folder, so the web UI must be under
`server\static`.

## What The Installer Does

- Installs the WinUI GUI and all publish output.
- Installs the C++ server executable and its runtime DLLs.
- Installs the browser upload frontend under `server\static`.
- Creates Start Menu and optional Desktop shortcuts with the app icon.
- Optionally adds private/local-subnet Windows Firewall rules for the server
  executable: inbound TCP transfers and UDP discovery on port `45892`.
- Preserves `%LOCALAPPDATA%\LocalMediaTransfer` on uninstall unless the user
  explicitly chooses to delete settings, logs, history, and benchmark data.

## Troubleshooting

### Shortcut Opens "The system cannot find the file specified"

The shortcut target must be:

```text
{app}\LocalMediaTransfer.GUI.exe
```

If it points to `{app}\GUI\LocalMediaTransfer.GUI.exe`, the installer was built
from an old script.

### GUI Starts But Server Cannot Start

Verify the installed server exists here:

```text
{app}\server\LocalMediaTransferServer.exe
```

Also verify the static web UI exists here:

```text
{app}\server\static\index.html
```

### Missing Icon

The installer uses:

```text
src\LocalMediaTransfer.GUI\Assets\Icons\AppIcon.ico
```

That icon is copied into the app publish output and used for Setup, Start Menu,
Desktop shortcuts, and the application executable.
