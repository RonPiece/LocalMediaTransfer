# Application Environments

Local Media Transfer uses one source tree across development workflows and the
validated `test`, `benchmark`, and `production` runtime environments. A runtime
environment selects identity and storage; it is not the same as a compiler
configuration such as Debug or Release.

This document defines the target contract. Components must not claim an
environment is isolated until their implementation and tests listed below are
complete.

Current implementation status: the C++ server and isolated server harness apply
the server-side identity, storage, port, pipe, mutex, and discovery rules.
Health, configuration, token verification, pairing, QR, and discovery payloads
carry the environment identity, and iOS rejects a missing or mismatched identity
before trusting the server. The Windows project builds distinct production and
test executables with visibly different identity and isolated desktop state.
Automated GUI smoke runs use the test executable and a GUID-scoped temporary
root. Stale-server recovery now uses authenticated exact-process ownership
proof rather than process-name enumeration. Production and TEST iOS variants
have separate identities, discovery ports, and storage namespaces; Expo Go maps
to TEST. The manual unsigned-IPA workflow defaults to production and retains
TEST as an explicit choice. Privacy-redacted on-device diagnostic export is
implemented. Browser end-to-end isolation remains later work.

## Environment purposes

| Environment | Purpose | Data policy |
|---|---|---|
| Development workflow | Fast local work, Expo Go, mocks, and Debug builds; uses the `test` runtime | Disposable or synthetic data only |
| `test` | Installed test applications and end-to-end correctness checks | Dedicated test storage; never the production upload folder |
| `benchmark` | Opt-in Release performance measurements | Dedicated benchmark storage and database |
| `production` | Normal user transfers | User-selected production storage |

Debug and Release remain build configurations. Correctness tests may exercise a
Release server in the `test` environment, and performance measurements must use
a Release server in the `benchmark` environment.

## Shared runtime contract

Every process and client must derive behavior from one validated environment
configuration. The configuration owns:

- environment name
- instance namespace
- application data, log, and diagnostics roots
- upload, hash-index, history, pairing, TLS, and benchmark storage
- HTTPS, HTTP fallback, and discovery ports
- named-pipe and single-instance mutex names
- expected peer environment
- diagnostics and benchmark policies
- source commit and application version reported in diagnostics

Unknown environment values must fail startup with a clear error. Production is
the compatibility default for released desktop binaries; test and benchmark
must always be selected explicitly.

## Target identities

| Resource | Test | Benchmark | Production |
|---|---|---|---|
| Namespace | `LocalMediaTransfer.Test` | `LocalMediaTransfer.Benchmark` | `LocalMediaTransfer` |
| Data root | `%LOCALAPPDATA%\LocalMediaTransfer.Test` | `%LOCALAPPDATA%\LocalMediaTransfer.Benchmark` | `%LOCALAPPDATA%\LocalMediaTransfer` |
| Default uploads | Test data root | Explicit dedicated directory | User-selected folder |
| HTTPS port | `18443` | Explicit or ephemeral | `8443` |
| HTTP port | `18080` | Explicit or ephemeral | `8080` |
| UDP discovery port | `45893` | Disabled | `45892` |
| Named pipe | `LocalMediaTransferPipe.Test` | Dedicated per run | `LocalMediaTransferPipe` |
| Server mutex | `LocalMediaTransferServer.Test.SingleInstance` | Dedicated per run | `LocalMediaTransferServer.SingleInstance` |
| GUI mutex | `Local\LocalMediaTransfer.GUI.Test` | Not applicable | `Local\LocalMediaTransfer.GUI` |

Automated suites remain more isolated than the stable test application: they
use `%TEMP%\LocalMediaTransfer.Tests\<guid>`, an available ephemeral port, a
random token, and process-specific resources owned by the harness.
The GUI smoke test sets `LMT_TEST_DATA_ROOT` to such a GUID root; the TEST build
accepts that override only when the resolved path remains below the isolated
test root and forwards the same root to its owned server.

## Filesystem and process invariants

- Test and benchmark processes must never read, write, rename, move, or delete
  files in the production upload directory.
- Test defaults must never silently fall back to the user's Pictures folder.
- Cleanup must validate that every target is below its declared test or
  benchmark root before deletion.
- Each environment owns separate hash, history, pairing, TLS, log, and
  diagnostics data.
- Normal stop, restart, and disposal affect only the process object launched and
  tracked by the current GUI manager and protected by its Windows job object.
- Conflict recovery never enumerates processes by executable name. It requires
  an authenticated proof containing the exact server PID and creation time,
  recorded GUI-owner PID and creation time, environment, runtime instance,
  control-instance ID, and named-pipe endpoint.
- Test and production may run side by side without sharing a mutex, named pipe,
  port, database, TLS identity, or settings file.
- Windows named pipes reject remote clients and grant access only to the current
  logon session, Local System, and local administrators.
- Benchmark routes and storage exist only when the benchmark environment and
  explicit benchmark mode are both enabled.

## Client compatibility contract

Health, discovery, token-verification, pairing, and version 3 QR payloads carry
an environment identifier. iOS rejects a server from a different environment,
or an older server that omits identity, with a clear message before token
verification or trusted reconnect. Discovery packets remain credential-free.

| Client | Allowed server |
|---|---|
| Production iOS app | `production` |
| Test iOS app | `test` |
| Expo Go development client | `test` |
| Browser served by the server | Its serving server |

The production and test iOS variants use distinct bundle identifiers so they
can coexist and keep SecureStore, permissions, and trusted-server state
separate.

## Windows application variants

The production build remains the default:

```powershell
dotnet build .\src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj `
  -c Debug -p:Platform=x64
```

Build the test application explicitly:

```powershell
dotnet build .\src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj `
  -c Debug -p:Platform=x64 -p:LmtEnvironment=Test
```

The test output is under `bin\x64\Debug-Test` and is named
`LocalMediaTransfer.GUI.Test.exe`. Its window title, tray tooltip, About card,
and persistent amber banner say `TEST`. It launches the server with
`--environment test`, ports `18443`/`18080`, the test named pipe, test TLS and
settings roots, and a default upload directory under
`%LOCALAPPDATA%\LocalMediaTransfer.Test`.

Production and test use different GUI and server mutexes, so they can run side
by side. Neither GUI terminates a process based on its name. Each environment
stores a separate 256-bit control key protected with current-user Windows DPAPI;
the key is delivered to a newly launched server through redirected standard
input and never through its command line. A conflict probe uses fresh client and
server nonces and HMAC-SHA-256 to bind the proof to the process identities,
environment, runtime instance, control instance, and pipe. The GUI independently
checks the server executable and Windows process creation time. If the recorded
GUI owner still exists with the same executable and creation time, recovery is
refused. If that owner is gone, the user must explicitly approve recovery; the
GUI then repeats the proof to prevent a time-of-check/time-of-use substitution
and requests graceful self-shutdown over the authenticated pipe. A legacy,
inaccessible, mismatched, or incorrectly signed server is left untouched.

The same control key authenticates every normal GUI-owned pipe connection. The
live proof also binds the exact owned server PID and creation time; the server
withholds ordinary telemetry and rejects ordinary commands until the proof
succeeds. Security mutations use correlated acknowledgements, and the GUI
replays the desired token, auto-approval, and discovery state after reconnect.
The TEST GUI smoke writes a credential-free marker only after that replay is
acknowledged.

The control key proves possession by a Local Media Transfer process running as
the same Windows user; DPAPI does not defend against arbitrary malicious code
already executing as that user. The server executable/path check, exact creation
times, per-launch instance ID, re-probe, and explicit adoption confirmation are
additional fail-closed controls within that threat boundary.

## Diagnostics contract

Normal telemetry stays bounded and best-effort. The client-log endpoint requires
the current upload credential, bounds and neutralizes text fields, and redacts
known secret and media-identity fields. Test diagnostics may contain a single
structured summary per transfer plus bounded numeric measurements needed to
diagnose fallbacks or mismatches. Client-supplied diagnostics must never contain
credentials, pairing URLs, certificate fingerprints, file contents, GPS data,
complete Photos asset identifiers, or filenames. Personal device diagnostics
and generated artifacts are not committed. Local server operational logs and
the filename index predate this diagnostics contract and require a separate
retention/redaction decision before diagnostic bundles are implemented.

## Source-control contract

Environment implementation, safe defaults, tests, workflow definitions,
synthetic fixtures, schemas, and documentation belong in Git. Local overrides,
tokens, TLS private keys, pairing databases, uploads, logs, diagnostic bundles,
benchmark databases, IPAs, and personal media do not.

The same reviewed source commit progresses through automated tests, a test
artifact, physical-device acceptance, and an explicitly approved production
artifact. Separate long-lived test and production source branches are not the
environment boundary.

## Delivery sequence

1. Isolate C++ server identities and runtime storage.
2. Add protocol-level environment identity and mismatch rejection.
3. Add a visibly distinct Windows test application.
4. Add a co-installable iOS test variant and keep Expo Go development-only.
5. Add bounded structured diagnostics.
6. Add isolated browser end-to-end tests and complete CI gates.
7. Add separately approved test-artifact and production-release workflows.
