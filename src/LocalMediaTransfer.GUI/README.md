# LocalMediaTransfer.GUI

Developer guide for the Windows desktop app. The user-facing overview lives in
the [root README](../../README.md).

## Purpose

`LocalMediaTransfer.GUI` is the WinUI 3 desktop shell for normal Windows use. It
owns the local server process, presents separate Receive and Send experiences,
manages native Windows/iPhone/browser pairing, shows network/security state,
displays transfers, and provides tray behavior.

The GUI should be treated as the product entry point. The C++ server is started
and monitored by the GUI for normal users.

## Relationship to the server

- The GUI starts, restarts, and stops only the server process it owns.
- If another server is already running, conflict recovery must remain explicit
  and user-confirmed. Recovery requires an HMAC-authenticated ownership proof,
  exact PID/creation-time and executable checks, the matching environment,
  runtime instance, launch instance, and pipe, plus a second proof immediately
  before graceful shutdown.
- The GUI authenticates each live named-pipe session with the DPAPI-protected
  control key and verifies that it is connected to the exact owned server PID,
  creation time, environment, runtime instance, control instance, and pipe.
- Security commands use correlated acknowledgements. The GUI replays the
  current session token, auto-approval choice, and discovery choice after every
  authenticated reconnect before it reports the server as running.
- Settings changes that affect transport or upload behavior should restart the
  owned server without touching unrelated processes.
- QR/session token display belongs in the GUI; trusted-device access belongs in
  the security/revocation surfaces.

See the [server developer guide](../Server/README.md) for server internals.

## Source structure

```text
App/           App-shell helpers: dialogs, navigation, QR rendering, shell launch, logs
Assets/        Icons and image assets
Features/      Receive (Dashboard), Send, Activity, Network, Security, Settings, and About
Models/        Shared GUI display models
Properties/    Launch and project metadata
Resources/     Shared XAML styles and text resources
Services/      Server, pipe, settings, and network services
```

Keep XAML pages as the visual layer. Put presentation state in feature view
models, reusable display data in `Models`, app-shell behavior in `App`, and
server lifecycle, persistence, IPC, and reusable logic under `Services`.
Discovery, certificate pinning, DPAPI receiver trust, native pairing, manifest
preparation, upload scheduling, retries, cancellation, and outbound metrics live
in the non-UI `LocalMediaTransfer.WindowsClient` project.

## Build and verification

Run commands from the repository root.

```powershell
dotnet build .\src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj -c Debug -p:Platform=x64
```

Build the visibly marked, storage-isolated test application with:

```powershell
dotnet build .\src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj `
  -c Debug -p:Platform=x64 -p:LmtEnvironment=Test
```

This produces `LocalMediaTransfer.GUI.Test.exe` under `bin\x64\Debug-Test`.
See [Application Environments](../../docs/ENVIRONMENTS.md) for its ports,
storage, process identity, and safety contract.

Focused C# tests:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_csharp.ps1
```

Full verification dispatcher:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -Target all
```

The installer builder validates required published WinUI views, server files,
and browser assets before invoking Inno Setup. Use `-StageOnly` for layout-only
validation or run it normally to compile the setup executable:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\tools\LocalMediaTransfer.InnoSetup\build.ps1
```

Repository validation separately checks that installer firewall rules stay
private-profile/local-subnet scoped for the TCP receiver and UDP discovery
ports. Installation, upgrade, uninstall, and actual Windows Firewall behavior
still require a manual installer smoke test.

The opt-in physical native-transfer runner and its exact sender/receiver steps
are documented in
[Native Windows two-PC acceptance](../../docs/NATIVE_WINDOWS_TWO_PC_ACCEPTANCE.md).
It is intentionally excluded from `verify -Target all` because it writes
generated files to a separately operated receiver and requires human code and
approval decisions.

## Runtime and debugging notes

- This is an unpackaged, framework-dependent WinUI 3 app.
- Do not use packaged-only settings APIs for unpackaged runtime state.
- `Process.MainWindowHandle` is unreliable for WinUI 3 smoke tests; enumerate
  windows by process ID when automated close behavior is needed.
- For layout changes, build x64 and smoke-launch the app.
- Run automated smoke tests against the TEST executable with a validated
  `%TEMP%\LocalMediaTransfer.Tests\<guid>` root; do not load or rewrite
  production GUI settings. The smoke test waits for a TEST-only,
  credential-free marker written after authenticated security-state
  reconciliation is acknowledged.
- Verify compact and expanded navigation states at the minimum supported window
  size when changing shell layout.

## Do not break

- Do not stop or kill server processes the GUI did not start.
- Neither build may enumerate or terminate unowned server processes;
  executable names do not prove environment or ownership.
- Never place the persistent server-control key on the command line or in logs.
  It is DPAPI-protected at rest and sent to the owned child through stdin.
- Never report a security-setting mutation as complete before its correlated
  server acknowledgement. Reapply persisted desired policy after reconnect.
- Keep auto-approval fail-closed: its unconfigured/default state is disabled.
- Use the typed connection launcher for browser links, and use sensitive
  clipboard writes for tokens and connection links.
- Browser links are manual, single-use five-minute credentials. Keep the
  visible countdown, copied URL, and browser QR synchronized; creating a
  replacement must invalidate the previous server-side bootstrap.
- Do not silently recover from external server conflicts.
- Do not hide partial listener startup failures as healthy state.
- Do not display HTTP fallback as equivalent to HTTPS.
- Do not expose trusted-device credentials to the dashboard.
- Keep user-facing security text consistent with the server and iOS app.

## Related docs

- [Root README](../../README.md)
- [C++ server developer guide](../Server/README.md)
- [Discovery and pairing](../../docs/DISCOVERY_AND_PAIRING.md)
- [Security policy](../../SECURITY.md)
- [Installer build guide](../../tools/LocalMediaTransfer.InnoSetup/README.md)
