# Run the Windows GUI

The WinUI 3 application is the main Local Media Transfer product. It is one
dual-role executable: Receive launches and owns the C++ server; Send discovers,
pairs with, and uploads to another Windows receiver. The same receiver preserves
the separate iPhone QR and Browser transfer compatibility options.

Receive is intentionally connection-focused. Browser transfer opens as a
compact anchored options flyout, so it does not resize the iPhone card. Live
receiver speed, session totals, the speed chart, and recent transfer history
are available on the separate Activity page.

Browser access is not created automatically. Select **Create browser link**
only when the other device is ready, then copy the complete link or scan the
browser-specific QR with an iPhone, Android phone, tablet, or computer camera.
The link is single-use and remains valid for at most five minutes; its countdown
is shown in the flyout, and replacing it invalidates the old link.

## Prerequisites

- Visual Studio 2022 or later.
- Desktop development with C++.
- .NET 8 SDK.
- Native dependencies restored with `scripts\bootstrap-dependencies.ps1`.

## Build

From the repository root:

```powershell
.\src\Server\build.bat Debug
dotnet build .\src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj `
  -c Debug -p:Platform=x64
```

Open `src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.slnx` and select the
`LocalMediaTransfer.GUI (Unpackaged)` profile.

## Runtime behavior

The GUI starts the server and exchanges status over Windows Named Pipes.
Closing X hides a normal build to the tray when Minimize to System Tray is
enabled. Use Exit from the tray menu to close the GUI and its owned server.

During Visual Studio debugging, X performs a full close so hidden debug
processes do not keep output files locked.

## Troubleshooting

- A server conflict means another server process is already running. The GUI
  leaves it untouched unless the user confirms recovery.
- If the server executable is missing, rebuild `src\Server` with the matching
  Debug or Release configuration.
- Use `tests\LocalMediaTransfer.GuiSmoke` for lifecycle verification.
