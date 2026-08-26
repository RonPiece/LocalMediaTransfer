# Developer Benchmarking Guide

The benchmark system is private, opt-in developer tooling. Normal GUI and
headless runs do not create benchmark routes, collect telemetry, or open the
benchmark database.

## Safety and Security

- Select `--environment benchmark` and pass `--benchmark-mode` together to
  register `/_dev/benchmark/*`.
- All benchmark endpoints require the normal `X-Upload-Token`.
- Benchmark startup requires a per-run `--instance-id`, an explicit upload
  directory, and explicit HTTPS and HTTP port values.
- `--benchmark-db` is rejected unless the benchmark environment and benchmark
  mode are both active.
- Only one benchmark run may be active. A second start returns HTTP `409`.
- The GUI never enables benchmark mode automatically.
- Benchmark output may contain machine and hardware details. Do not publish the
  database or exports without reviewing them.

## Build

Use Release builds for throughput measurements:

```powershell
.\src\Server\build.bat Release
dotnet build .\tools\LocalMediaTransfer.Benchmarks\LocalMediaTransfer.Benchmarks.csproj -c Release
```

## Start the Server

Without `--data-root` or `--benchmark-db`, the benchmark database is isolated
under the per-run runtime root:

```text
%LOCALAPPDATA%\LocalMediaTransfer.Benchmark\instances\<instance-id>\benchmarks\benchmarks.db
```

Start with the default location:

```powershell
$runId = [guid]::NewGuid().ToString("N")
.\src\Server\out\build\x64-release\bin\LocalMediaTransferServer.exe `
  --environment benchmark `
  --instance-id $runId `
  --https-port 18444 `
  --http-port 18081 `
  --upload-dir "D:\LocalMediaTransfer-Benchmark-Uploads" `
  --allow-insecure-http `
  --benchmark-mode
```

Or choose an explicit private database:

```powershell
$runId = [guid]::NewGuid().ToString("N")
.\src\Server\out\build\x64-release\bin\LocalMediaTransferServer.exe `
  --environment benchmark `
  --instance-id $runId `
  --data-root "D:\LMT-Private\runtime" `
  --https-port 18444 `
  --http-port 18081 `
  --upload-dir "D:\LocalMediaTransfer-Benchmark-Uploads" `
  --allow-insecure-http `
  --benchmark-mode `
  --benchmark-db "D:\LMT-Private\benchmarks.db"
```

Copy the token printed in the server URL:

```powershell
$env:LMT_BENCHMARK_TOKEN = "the-token-from-the-server-url"
```

## Run Profiles

```powershell
dotnet run --project .\tools\LocalMediaTransfer.Benchmarks -c Release -- `
  --profile smoke `
  --server http://127.0.0.1:18081 `
  --transport loopback
```

Available profiles:

| Profile | Workload | Purpose |
|---|---|---|
| `smoke` | 1 B, 4 KiB, 5 MiB, 99/100/101 MiB | Correctness and threshold coverage |
| `standard` | 20 x 5 MiB, 100 MiB, 1 GiB; one warm-up and three measured runs | Repeatable baseline |
| `soak` | Repeated 5 GiB transfers | Stalls, memory growth, thermals |
| `tune` | 4/8/16/32/64 MiB chunks x 1/2/4 concurrent files | Chunk and concurrency sweep |
| `manual` | Records while you transfer from iPhone/Safari | Real-device observation |

The `tune` profile can write tens of gigabytes. Run it only against a dedicated
upload directory with enough free space.

Useful options:

```text
--server <url>
--certificate-fingerprint <sha256>
--token <token>
--profile <name>
--chunk-size-mb <n>
--file-concurrency <n>
--iterations <n>
--transport <label>
--network-baseline-mbps <n>
--notes <text>
--build-configuration <name>
--export-dir <path>
--keep-files
```

Pinned HTTPS benchmarks require the exact server certificate SHA-256 through
`--certificate-fingerprint` or `LMT_BENCHMARK_TLS_FINGERPRINT`; the benchmark
client never accepts an arbitrary self-signed certificate. Compare warmed HTTP
and HTTPS runs with identical files and settings. Investigate a median HTTPS
regression above 5%, and treat a regression above 10% as a release blocker.

The token comes from `LMT_BENCHMARK_TOKEN` unless `--token` is supplied.
Generated source files are placed below
`%TEMP%\LocalMediaTransfer.Benchmarks\<guid>` and deleted after the run unless
`--keep-files` is used. Before generating data, the runner checks temporary-drive
free space against the complete profile's generated source volume plus a safety
margin, and prints the expected total transfer volume.

## Manual iPhone Run

```powershell
dotnet run --project .\tools\LocalMediaTransfer.Benchmarks -c Release -- `
  --profile manual `
  --server http://192.168.1.20:8080 `
  --transport wifi `
  --notes "iPhone 15 Safari, 5 GHz"
```

Start the command, perform the transfer from Safari, then press Enter. Manual
mode records the observation window and machine samples in the same database.
Browser automation and automatic per-file attribution are intentionally
deferred; add the file mix to `--notes`.

For native-app comparisons, transfer the same large local video twice and label
the notes `expo-base64` and `native-raw`. The iOS client also logs
`preparationDurationMs`, `preflightDurationMs`, and the selected transport. Keep
the phone position, Wi-Fi band, server build, upload disk, chunk size, and file
concurrency unchanged. Compare medians against an iPhone-to-PC iperf3 result;
the ISP subscription speed is not the local-network baseline.

## Stored Data

`BenchmarkStore` uses SQLite WAL mode, prepared statements, transactions, and
schema version `2`. Version `1` developer databases are migrated automatically
to correct throughput column units.

| Table | Contents |
|---|---|
| `benchmark_schema` | Schema version |
| `benchmark_machines` | OS, CPU/core counts, RAM, NIC/link speed, storage metadata, fingerprint |
| `benchmark_runs` | Build/profile configuration, totals, percentiles, retries, errors, notes |
| `benchmark_samples` | One-second throughput, CPU, memory, process I/O, network and byte counters |
| `benchmark_files` | File size/mode/timing, retries, HTTP result, expected and actual SHA-256 |

Database throughput columns use the explicit `_mb_per_s` suffix. API and export
fields use `MBps`; both mean megabytes per second. Network link and iperf3
baseline fields use `Mbps`, meaning megabits per second.

Samples are held in memory and inserted in batches of ten to reduce telemetry
distortion. Full-file SHA-256 is calculated by the server only after the timed
transfer phase. Production uploads separately compute a streaming full-file
SHA-256 on the server and persist the verified digest-to-filename index in
`hashes.db`.

Each completed run is also exported as JSON and CSV under:

```text
%LOCALAPPDATA%\LocalMediaTransfer\benchmarks\exports
```

## Interpreting Throughput

- `MB/s` is decimal megabytes per second: `1 MB = 1,000,000 bytes`.
- Binary file and chunk sizes are written as `MiB` or `GiB`.
- `Mbps` means megabits per second.
- Convert with `MB/s x 8 = Mbps`.
- A 1 Gbps link has a theoretical ceiling of `125 MB/s`; protocol, disk, CPU,
  Wi-Fi, and endpoint overhead reduce the practical result.

Measure the network independently with `iperf3`, then pass the result:

```powershell
dotnet run --project .\tools\LocalMediaTransfer.Benchmarks -c Release -- `
  --profile standard `
  --network-baseline-mbps 940 `
  --transport ethernet
```

The runner reports application throughput as a percentage of that baseline.
There is no universal speed pass/fail threshold because storage and network
equipment differ.

## Profiling Bottlenecks

Use the benchmark timeline to locate a slow interval, then capture it with
Windows Performance Recorder:

```powershell
wpr -start CPU -start DiskIO -filemode
# Run the benchmark.
wpr -stop lmt-benchmark.etl
```

Open the ETL in Windows Performance Analyzer and inspect:

- CPU Usage (Sampled)
- Disk Usage and Storage I/O
- Process Working Set
- Networking activity
- context switches and thread wait time

Compare loopback, wired Ethernet, and Wi-Fi separately. Loopback primarily
tests software and storage; it does not measure the physical network.

## Safe Cleanup

Stop the server before removing a benchmark database so WAL sidecar files are
closed. Generated runner sources are automatically removed. Uploaded benchmark
files are production uploads from the server's perspective, so use a dedicated
`--upload-dir` and delete that directory manually after confirming its path.

Do not point benchmark uploads at a personal photo library.
