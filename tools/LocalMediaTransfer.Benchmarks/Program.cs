using System.Diagnostics;
using System.Globalization;

namespace LocalMediaTransfer.Benchmarks;

internal static class Program
{
    private const string ProductVersion = "2.0.0";

    public static async Task<int> Main(string[] args)
    {
        try
        {
            BenchmarkOptions options = BenchmarkOptions.Parse(args);
            if (options.ShowHelp)
            {
                BenchmarkOptions.PrintHelp();
                return 0;
            }

            using var cancellation = new CancellationTokenSource();
            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                cancellation.Cancel();
            };

            IReadOnlyList<BenchmarkRunSpec> runs = BenchmarkProfiles.Create(options);
            long expectedBytes = BenchmarkProfiles.ExpectedBytes(runs);
            Console.WriteLine(
                $"Profile '{options.Profile}' will transfer approximately {FormatBytes(expectedBytes)}.");
            Console.WriteLine($"Server: {options.Server}");
            Console.WriteLine($"Exports: {options.ExportDirectory}");

            string tempRoot = Path.Combine(
                Path.GetTempPath(),
                "LocalMediaTransfer.Benchmarks",
                Guid.NewGuid().ToString("N"));
            EnsureFreeSpace(tempRoot, runs);
            Directory.CreateDirectory(tempRoot);

            try
            {
                MachineMetadata machine = MachineInfo.Collect(tempRoot);
                using var client = new BenchmarkClient(
                    options.Server, options.Token, options.CertificateFingerprint);

                foreach (BenchmarkRunSpec run in runs)
                {
                    cancellation.Token.ThrowIfCancellationRequested();
                    await ExecuteRunAsync(
                        client,
                        machine,
                        options,
                        run,
                        tempRoot,
                        cancellation.Token);
                }
            }
            finally
            {
                if (options.KeepFiles)
                {
                    Console.WriteLine($"Generated files kept at: {tempRoot}");
                }
                else
                {
                    SafeDeleteTempDirectory(tempRoot);
                }
            }

            return 0;
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("Benchmark cancelled.");
            return 2;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Benchmark failed: {ex.Message}");
            return 1;
        }
    }

    private static async Task ExecuteRunAsync(
        BenchmarkClient client,
        MachineMetadata machine,
        BenchmarkOptions options,
        BenchmarkRunSpec run,
        string tempRoot,
        CancellationToken cancellationToken)
    {
        string runDirectory = Path.Combine(tempRoot, run.Label);
        IReadOnlyList<GeneratedFile> files = [];
        if (run.Files.Count > 0)
        {
            Console.WriteLine($"[{run.Label}] Generating {run.Files.Count} deterministic source file(s)...");
            files = await DeterministicFileGenerator.GenerateAsync(
                runDirectory,
                run,
                cancellationToken);
        }

        string profileLabel = run.IsWarmup ? $"{run.Profile}-warmup" : run.Profile;
        var startRequest = new StartRunRequest(
            machine,
            await GetGitCommitAsync(cancellationToken),
            ProductVersion,
            ProductVersion,
            options.BuildConfiguration,
            profileLabel,
            options.Transport,
            run.ChunkSizeBytes,
            run.FileConcurrency,
            options.NetworkBaselineMbps,
            JoinNotes(options.Notes, run.Label));
        string runId = await client.StartRunAsync(startRequest, cancellationToken);
        Console.WriteLine($"[{run.Label}] Benchmark run {runId} started.");

        try
        {
            if (run.Profile == "manual")
            {
                await ExecuteManualRunAsync(client, options, run, runId, cancellationToken);
                return;
            }

            var samples = new List<BenchmarkSample>();
            var transferClock = Stopwatch.StartNew();
            using var samplingCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            Task sampler = CollectSamplesAsync(
                client,
                runId,
                transferClock,
                samples,
                false,
                samplingCancellation.Token);

            IReadOnlyList<UploadedFile> uploads;
            try
            {
                uploads = await client.UploadFilesAsync(
                    files,
                    run.ChunkSizeBytes,
                    run.FileConcurrency,
                    cancellationToken);
            }
            finally
            {
                transferClock.Stop();
                samplingCancellation.Cancel();
                await AwaitSamplerAsync(sampler);
            }

            Console.WriteLine($"[{run.Label}] Transfer complete; verifying full-file SHA-256...");
            IReadOnlyList<UploadResult> results = await client.VerifyFilesAsync(
                runId,
                uploads,
                cancellationToken);

            long totalBytes = results.Where(result => string.IsNullOrEmpty(result.Error))
                .Sum(result => result.SizeBytes);
            double average = transferClock.Elapsed.TotalSeconds > 0
                ? totalBytes / 1_000_000d / transferClock.Elapsed.TotalSeconds
                : 0;
            double[] throughputSamples = samples.Select(sample => sample.ThroughputMBps)
                .Where(value => value > 0)
                .Order()
                .ToArray();
            double peak = throughputSamples.Length > 0
                ? throughputSamples.Max()
                : results.Select(result => result.ThroughputMBps).DefaultIfEmpty().Max();
            int errors = results.Count(result => !string.IsNullOrEmpty(result.Error));
            int retries = results.Sum(result => result.Retries);
            bool integrity = results.All(result => result.IntegrityOk);

            var finish = new FinishRunRequest(
                totalBytes,
                results.Count,
                transferClock.ElapsedMilliseconds,
                average,
                peak,
                Percentile(throughputSamples, 0.50),
                Percentile(throughputSamples, 0.95),
                Percentile(throughputSamples, 0.99),
                retries,
                errors,
                integrity,
                JoinNotes(options.Notes, run.Label),
                errors == 0 && integrity ? "completed" : "failed");
            await client.FinishRunAsync(runId, finish, cancellationToken);
            await ExportAndReportAsync(client, options, run, runId, average, cancellationToken);
        }
        catch (Exception ex)
        {
            await TryMarkRunFailedAsync(client, runId, run, options, ex);
            throw;
        }
    }

    private static async Task TryMarkRunFailedAsync(
        BenchmarkClient client,
        string runId,
        BenchmarkRunSpec run,
        BenchmarkOptions options,
        Exception exception)
    {
        try
        {
            await client.FinishRunAsync(
                runId,
                new(
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    1,
                    false,
                    JoinNotes(options.Notes, $"{run.Label}; {exception.Message}"),
                    "failed"),
                CancellationToken.None);
        }
        catch
        {
            // The server may already have finalized the run or become unavailable.
        }
    }

    private static async Task ExecuteManualRunAsync(
        BenchmarkClient client,
        BenchmarkOptions options,
        BenchmarkRunSpec run,
        string runId,
        CancellationToken cancellationToken)
    {
        Console.WriteLine("Manual recording is active. Perform the iPhone/Safari transfer now.");
        Console.WriteLine("Press Enter when the transfer is complete.");
        var samples = new List<BenchmarkSample>();
        var clock = Stopwatch.StartNew();
        using var samplingCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        Task sampler = CollectSamplesAsync(
            client,
            runId,
            clock,
            samples,
            true,
            samplingCancellation.Token);
        await Task.Run(Console.ReadLine, cancellationToken);
        clock.Stop();
        samplingCancellation.Cancel();
        await AwaitSamplerAsync(sampler);

        long totalBytes = samples.LastOrDefault()?.TransferredBytes ?? 0;
        double average = clock.Elapsed.TotalSeconds > 0
            ? totalBytes / 1_000_000d / clock.Elapsed.TotalSeconds
            : 0;
        double[] values = samples.Select(sample => sample.ThroughputMBps)
            .Where(value => value > 0)
            .Order()
            .ToArray();
        await client.FinishRunAsync(
            runId,
            new(
                totalBytes,
                0,
                clock.ElapsedMilliseconds,
                average,
                values.DefaultIfEmpty().Max(),
                Percentile(values, 0.50),
                Percentile(values, 0.95),
                Percentile(values, 0.99),
                0,
                0,
                true,
                JoinNotes(options.Notes, run.Label)),
            cancellationToken);
        await ExportAndReportAsync(client, options, run, runId, average, cancellationToken);
    }

    private static async Task CollectSamplesAsync(
        BenchmarkClient client,
        string runId,
        Stopwatch clock,
        List<BenchmarkSample> samples,
        bool useNetworkForTransferredBytes,
        CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        using Process process = MachineInfo.GetMetricsProcess();
        TimeSpan previousCpu = process.TotalProcessorTime;
        long previousTransferred = client.TransferredBytes;
        long previousNetwork = MachineInfo.ReadNetworkBytes();
        long previousElapsed = clock.ElapsedMilliseconds;
        long measuredNetworkBytes = 0;

        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            process.Refresh();
            long elapsed = clock.ElapsedMilliseconds;
            long transferred = client.TransferredBytes;
            long network = MachineInfo.ReadNetworkBytes();
            TimeSpan cpu = process.TotalProcessorTime;
            double elapsedSeconds = Math.Max(0.001, (elapsed - previousElapsed) / 1000d);
            long networkDelta = Math.Max(0, network - previousNetwork);
            long transferDelta = useNetworkForTransferredBytes
                ? networkDelta
                : Math.Max(0, transferred - previousTransferred);
            if (useNetworkForTransferredBytes)
            {
                measuredNetworkBytes += networkDelta;
                transferred = measuredNetworkBytes;
            }
            double throughput = transferDelta / 1_000_000d / elapsedSeconds;
            double cpuPercent = (cpu - previousCpu).TotalMilliseconds /
                                Math.Max(1, elapsed - previousElapsed) /
                                Math.Max(1, Environment.ProcessorCount) * 100d;
            (long ioRead, long ioWrite) = MachineInfo.ReadProcessIo(process);
            var sample = new BenchmarkSample(
                elapsed,
                throughput,
                cpuPercent,
                process.WorkingSet64,
                ioRead,
                ioWrite,
                networkDelta,
                transferred);
            samples.Add(sample);
            await client.AddSampleAsync(runId, sample, cancellationToken);

            previousCpu = cpu;
            previousTransferred = transferred;
            previousNetwork = network;
            previousElapsed = elapsed;
        }
    }

    private static async Task AwaitSamplerAsync(Task sampler)
    {
        try
        {
            await sampler;
        }
        catch (OperationCanceledException)
        {
        }
    }

    private static async Task ExportAndReportAsync(
        BenchmarkClient client,
        BenchmarkOptions options,
        BenchmarkRunSpec run,
        string runId,
        double averageMBps,
        CancellationToken cancellationToken)
    {
        string json = await client.GetRunJsonAsync(runId, cancellationToken);
        (string jsonPath, string csvPath) = await BenchmarkExporter.ExportAsync(
            options.ExportDirectory,
            runId,
            run.Label,
            json,
            cancellationToken);
        Console.WriteLine($"[{run.Label}] Average throughput: {averageMBps:F2} MB/s ({averageMBps * 8:F1} Mbps)");
        if (options.NetworkBaselineMbps > 0)
        {
            Console.WriteLine(
                $"[{run.Label}] Application throughput: " +
                $"{averageMBps * 8 / options.NetworkBaselineMbps * 100:F1}% of iperf3 baseline.");
        }
        Console.WriteLine($"[{run.Label}] JSON: {jsonPath}");
        Console.WriteLine($"[{run.Label}] CSV:  {csvPath}");
    }

    private static double Percentile(double[] sortedValues, double percentile)
    {
        if (sortedValues.Length == 0) return 0;
        double position = (sortedValues.Length - 1) * percentile;
        int lower = (int)Math.Floor(position);
        int upper = (int)Math.Ceiling(position);
        if (lower == upper) return sortedValues[lower];
        double weight = position - lower;
        return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
    }

    private static void EnsureFreeSpace(string tempRoot, IReadOnlyList<BenchmarkRunSpec> runs)
    {
        string root = Path.GetPathRoot(Path.GetFullPath(tempRoot)) ??
                      throw new InvalidOperationException("Unable to resolve temporary drive.");
        long generatedBytes = BenchmarkProfiles.ExpectedBytes(runs);
        long required = checked(
            generatedBytes +
            Math.Max(512L * 1024 * 1024, generatedBytes / 10));
        long available = new DriveInfo(root).AvailableFreeSpace;
        if (available < required)
        {
            throw new IOException(
                $"Insufficient temporary disk space. Need {FormatBytes(required)}, " +
                $"available {FormatBytes(available)}.");
        }
    }

    private static void SafeDeleteTempDirectory(string path)
    {
        string root = Path.GetFullPath(Path.Combine(
            Path.GetTempPath(),
            "LocalMediaTransfer.Benchmarks"));
        string resolved = Path.GetFullPath(path);
        if (!resolved.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Refusing to delete unsafe path: {resolved}");
        if (Directory.Exists(resolved))
            Directory.Delete(resolved, recursive: true);
    }

    private static async Task<string> GetGitCommitAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "git",
                Arguments = "rev-parse HEAD",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            if (process is null) return "";
            Task<string> outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            Task<string> errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken).WaitAsync(TimeSpan.FromSeconds(5), cancellationToken);
            string output = await outputTask;
            _ = await errorTask;
            return process.ExitCode == 0 ? output.Trim() : "";
        }
        catch
        {
            return "";
        }
    }

    private static string JoinNotes(string notes, string label) =>
        string.IsNullOrWhiteSpace(notes) ? label : $"{notes}; {label}";

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KiB", "MiB", "GiB", "TiB"];
        double value = bytes;
        int unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }
        return $"{value.ToString("0.##", CultureInfo.InvariantCulture)} {units[unit]}";
    }
}
