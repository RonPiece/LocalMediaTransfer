# Server

Developer guide for the C++ transfer server. The user-facing overview lives in
the [root README](../../README.md).

## Purpose

`src/Server` contains the local C++ server used by the Windows GUI, installed
iOS app, and browser upload page. It handles transport, upload routes, duplicate
verification, persistence, telemetry, and optional local discovery.

The server is normally launched by `LocalMediaTransfer.GUI`. Headless use is for
development, tests, and advanced workflows.

Runtime behavior is selected with `--environment production|test|benchmark`.
Production remains the compatibility default. Test and benchmark runs use
separate data roots, ports, named pipes, mutexes, and discovery policy; automated
runs also pass a validated `--instance-id` and a temp-scoped `--data-root`. See
[Application Environments](../../docs/ENVIRONMENTS.md) for the contract.
Use `--print-runtime-config` to print the validated default identity as JSON and
exit before creating storage, acquiring a mutex, or opening a listener. The
integration harness uses this probe to test real defaults rather than duplicating
them in test code.

## Responsibilities

| Area | Responsibility |
|:---|:---|
| HTTPS | Primary app transport with a persistent local certificate identity |
| HTTP fallback | Optional compatibility listener only when explicitly enabled |
| Uploads | Multipart/browser uploads and native raw chunk uploads |
| Duplicate detection | Server-computed full-file SHA-256 and SQLite inventory |
| History | Local transfer history for GUI display |
| IPC | Named-pipe telemetry and control messages for the GUI |
| Discovery | Optional credential-free UDP discovery metadata |
| Static frontend | Browser upload UI under `static/` |
| Benchmarks | Opt-in developer-only benchmark mode and storage |

Do not overstate the file I/O path. Use “memory-mapped” or “reduced-copy” when
documenting it.

## Source structure

```text
include/     Server headers
src/         C++ implementation
static/      Browser upload frontend and local assets
build.bat    Windows build wrapper
```

Generated output, logs, local uploads, and build folders are ignored by Git.

## Build

Run commands from the repository root.

```powershell
.\src\Server\build.bat Debug
.\src\Server\build.bat Release
```

Use `build.bat`; it discovers Visual Studio with `vswhere`, initializes the x64
MSVC environment, and uses the Visual Studio CMake executable. Do not assume
`cmake` is already on `PATH`.

## Verification

Server integration harness:

```powershell
dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release
```

Browser/static frontend tests:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_frontend.ps1
```

Full dispatcher:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -Target all
```

For physical native Windows verification, use the opt-in
[two-PC acceptance runner](../../docs/NATIVE_WINDOWS_TWO_PC_ACCEPTANCE.md).
Receiver diagnostics are emitted as an allow-listed lifecycle stream in the
local operational log; the companion monitor copies only safe event names and
numeric counts into its report. Do not publish the raw server log.

## Test safety invariants

- Server tests may use only `%TEMP%\LocalMediaTransfer.Tests\<guid>`.
- Verify cleanup paths are below that test root before recursive deletion.
- Never inspect, write, or delete the normal Pictures upload folder in tests.
- Stop only processes launched and tracked by the current test or GUI manager.
- Stale-server recovery must use the authenticated ownership challenge over the
  exact environment pipe; never add process-name scanning or an external kill.
- The ownership key is accepted only through redirected stdin. Proof and
  shutdown HMACs bind both process creation times, environment, runtime and
  control instance IDs, pipe name, and fresh nonces.
- Named-pipe test clients must continuously drain server output to avoid false
  HTTP timeouts.
- GUI-owned server sessions must authenticate before ordinary commands or
  telemetry are accepted. The proof binds both process identities and creation
  times, environment, runtime/control instances, and pipe. Correlated commands
  return explicit success or failure.
- Discovery packets must not contain session tokens or trusted-device
  credentials.
- Named pipes reject remote clients and use an explicit current-logon ACL.
- `/client_log` requires authentication, bounds client-controlled fields,
  neutralizes control characters, and redacts known secret/media identifiers.
- Benchmark mode must remain opt-in and must not add routes, databases, or
  telemetry overhead to normal runs.

## Protocol and security notes

- HTTPS is the primary transport.
- TLS protects the connection; tokens and trusted-device credentials still
  provide authorization.
- HTTP fallback is unencrypted and must be explicitly enabled.
- Nearby discovery is credential-free and used for discovery/reconnect metadata,
  not first trust.
- First trust comes from QR/manual pairing plus Windows approval.
- Browser launch uses a manually requested random five-minute, one-time
  fragment bootstrap. A new bootstrap replaces and invalidates the previous
  one. The exchange consumes the code and returns the session token with
  `no-store`; expiry and replay are rejected. The static frontend removes
  bootstrap and legacy token material from browser history before continuing.
- Headless development/test launches without a GUI ownership key retain the
  current-logon ACL pipe mode; they do not claim authenticated GUI ownership.
- Pipe input is capped at 64 KiB and GUI-facing collections, identifiers,
  numeric values, timestamps, and display strings are validated before use.
  Transfer-history events are capped at 120 session summaries and exclude
  per-file details so a large transfer cannot exceed the GUI's 512 KiB frame.
- Duplicate detection uses SQLite as an index, not the source of truth; the
  server revalidates candidate files before skipping.

## Related docs

- [Root README](../../README.md)
- [Upload protocol](../../docs/UPLOAD_PROTOCOL.md)
- [Deduplication](../../docs/DEDUPLICATION.md)
- [Discovery and pairing](../../docs/DISCOVERY_AND_PAIRING.md)
- [Benchmarking](../../docs/BENCHMARKING.md)
- [Windows GUI developer guide](../LocalMediaTransfer.GUI/README.md)
