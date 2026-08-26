# Run the Headless Server

Headless mode is an optional developer and server-only workflow. The Windows
GUI remains the main product.

## Restore and build

```powershell
.\scripts\bootstrap-dependencies.ps1
.\src\Server\build.bat Release
```

If native dependency restore fails with `fatal error RC1107` from `rc.exe`, run:

```powershell
.\scripts\bootstrap-dependencies.ps1 -PreferVisualStudioTools
```

This keeps the pinned dependency versions and only changes local tool selection
inside vcpkg.

## Run

```powershell
.\src\Server\out\build\x64-release\bin\LocalMediaTransferServer.exe
```

The server prints localhost and LAN links containing the upload token. Use the
LAN link only on a trusted private network.

Common options:

| Option | Purpose | Default |
|---|---|---|
| `--environment <name>` | `production`, `test`, or `benchmark` runtime identity | `production` |
| `--instance-id <id>` | Process-specific test/benchmark identity | none |
| `--data-root <path>` | Test/benchmark runtime-data override | environment-specific LocalAppData |
| `--https-port <number>` | HTTPS listen port | production: `8443`; test: `18443` |
| `--http-port <number>` | Optional HTTP fallback port | production: `8080`; test: `18080` |
| `--allow-insecure-http` | Enable the HTTP fallback listener | disabled |
| `--upload-dir <path>` | Destination folder | production: `uploads`; test: isolated data root |
| `--static-dir <path>` | Browser frontend | auto-detected |
| `--filename-conflict <policy>` | `keep-both` or `reject` | `keep-both` |
| `--history-db <path>` | Transfer history database | LocalAppData |
| `--benchmark-mode` | Enable routes in the benchmark environment | disabled |
| `--benchmark-db <path>` | Benchmark database override | benchmark data root |

The `--port` option remains a compatibility alias for `--https-port`.
Benchmark startup requires `--environment benchmark`, `--benchmark-mode`, a
valid `--instance-id`, explicit ports, and an explicit upload directory.

Press `Ctrl+C` for graceful shutdown.

Exact duplicates are verified with full SHA-256 and skipped. Different content
with the same filename is stored as `name (2).ext` by default and is never
silently overwritten.

See [Benchmarking](../BENCHMARKING.md) and
[duplicate detection](../DEDUPLICATION.md).
