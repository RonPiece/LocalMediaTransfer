---
name: lmt-benchmarking
description: Run and interpret Local Media Transfer developer benchmarks for throughput, stability, concurrency, and integrity. Use for smoke, standard, soak, tune, or manual iPhone runs; iperf3 comparisons; hardware metadata; and bottleneck analysis. Do not use benchmark mode in normal app operation.
---

# LMT Benchmarking

Follow `docs\BENCHMARKING.md`. Preserve benchmark validity by separating setup,
timed transfer, telemetry, and integrity verification.

## Workflow

1. Build the server and runner in Release.
2. Use a dedicated upload directory with known free space.
3. Start the server with `--benchmark-mode`; add `--benchmark-db` only when an
   explicit private database location is needed.
4. Set `LMT_BENCHMARK_TOKEN`.
5. Choose the smallest profile that answers the question:
   - `smoke`: correctness and chunk threshold.
   - `standard`: repeatable baseline.
   - `soak`: stalls, thermal behavior, and memory growth.
   - `tune`: chunk-size and file-concurrency sweep.
   - `manual`: real iPhone/Safari observation.
6. Record transport, build configuration, notes, and an iperf3 baseline when
   available.
7. Compare JSON/CSV exports and the SQLite run, samples, and file outcomes.
8. Load `references/measurement-rules.md` before interpreting results or editing
   performance-sensitive code.

## Guardrails

- Benchmark routes and storage must not exist when mode is disabled.
- Never benchmark against a personal photo library.
- Do not include source-file generation or full SHA-256 verification in timed
  transfer throughput.
- Do not launch `tune` or `soak` without checking expected disk volume.
- Avoid heavyweight PowerShell jobs and per-sample process spawning.
- State conclusions as measured evidence, not universal performance promises.
