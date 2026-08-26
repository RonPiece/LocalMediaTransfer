# Measurement Rules

## Separate Limits

- Loopback: application, CPU, memory, and storage path.
- Wired LAN: application plus NIC, switch, protocol, and peer storage.
- Wi-Fi: add radio conditions, channel width, interference, and power state.
- iperf3: network baseline, not application or disk throughput.

Do not infer the bottleneck from one end-to-end number. Change one dimension at
a time and collect CPU, working set, process I/O, network use, and one-second
throughput samples.

## Units and Ceilings

- `MB/s`: decimal megabytes per second (`1 MB = 1,000,000 bytes`).
- Use `MiB` and `GiB` for binary file and chunk sizes.
- `Mbps`: megabits per second.
- `MB/s x 8 = Mbps`.
- 1 Gbps has a theoretical payload ceiling of 125 MB/s before protocol and
  system overhead.

Report application throughput as a percentage of the measured iperf3 baseline,
not as a percentage of the link label alone.

## Timed Region

Exclude:

- deterministic source generation
- warm-up runs
- full-file SHA-256 verification
- JSON/CSV export
- cleanup

Keep telemetry lightweight: in-memory counters, one-second samples, and batched
SQLite inserts.

## Workload Interpretation

- Small-file batches expose request, filesystem, and metadata overhead.
- 99/100/101 MiB files verify the chunk threshold.
- 1 GiB runs provide stable throughput without soak-level write volume.
- Repeated 5 GiB runs expose stalls, thermals, and memory growth.
- Chunk-size sweeps and file concurrency are distinct variables.
- Chunks remain sequential within each file.

## Accuracy

- Production duplicate detection is a server-computed full-file SHA-256 index
  in SQLite, with disk revalidation before skipping.
- Benchmark integrity is full-file SHA-256 after timing.
- Memory mapping is not strict zero-copy when data is still copied into the
  mapped view.
