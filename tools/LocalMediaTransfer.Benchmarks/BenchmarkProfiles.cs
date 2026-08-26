namespace LocalMediaTransfer.Benchmarks;

internal static class BenchmarkProfiles
{
    private const long KB = 1024;
    private const long MB = 1024 * KB;
    private const long GB = 1024 * MB;

    public static IReadOnlyList<BenchmarkRunSpec> Create(BenchmarkOptions options)
    {
        return options.Profile switch
        {
            "smoke" => Repeat(
                options,
                [new("1-byte.bin", 1), new("4-kib.bin", 4 * KB), new("5-mib.bin", 5 * MB),
                 new("99-mib.bin", 99 * MB), new("100-mib.bin", 100 * MB),
                 new("101-mib.bin", 101 * MB)],
                defaultIterations: 1,
                includeWarmup: false),
            "standard" => Repeat(
                options,
                Enumerable.Range(1, 20)
                    .Select(i => new BenchmarkFileSpec($"small-{i:00}-5-mib.bin", 5 * MB))
                    .Append(new("100-mib.bin", 100 * MB))
                    .Append(new("1-gib.bin", GB))
                    .ToArray(),
                defaultIterations: 3,
                includeWarmup: true),
            "soak" => Repeat(
                options,
                [new("5-gib.bin", 5 * GB)],
                defaultIterations: 3,
                includeWarmup: false),
            "tune" => CreateTune(options),
            "manual" => [new("manual", "manual", options.ChunkSizeBytes, options.FileConcurrency, [])],
            _ => throw new ArgumentOutOfRangeException(nameof(options.Profile))
        };
    }

    public static long ExpectedBytes(IReadOnlyList<BenchmarkRunSpec> runs) =>
        runs.Sum(run => run.Files.Sum(file => file.SizeBytes));

    private static IReadOnlyList<BenchmarkRunSpec> Repeat(
        BenchmarkOptions options,
        IReadOnlyList<BenchmarkFileSpec> files,
        int defaultIterations,
        bool includeWarmup)
    {
        var runs = new List<BenchmarkRunSpec>();
        if (includeWarmup)
        {
            runs.Add(new(
                options.Profile,
                "warmup",
                options.ChunkSizeBytes,
                options.FileConcurrency,
                files,
                IsWarmup: true));
        }

        int iterations = options.Iterations ?? defaultIterations;
        for (int index = 1; index <= iterations; index++)
        {
            runs.Add(new(
                options.Profile,
                $"run-{index}",
                options.ChunkSizeBytes,
                options.FileConcurrency,
                files));
        }
        return runs;
    }

    private static IReadOnlyList<BenchmarkRunSpec> CreateTune(BenchmarkOptions options)
    {
        long[] chunks = [4 * MB, 8 * MB, 16 * MB, 32 * MB, 64 * MB];
        int[] concurrency = [1, 2, 4];
        int repeats = options.Iterations ?? 1;
        var runs = new List<BenchmarkRunSpec>();

        foreach (long chunk in chunks)
        foreach (int files in concurrency)
        for (int iteration = 1; iteration <= repeats; iteration++)
        {
            BenchmarkFileSpec[] workload = Enumerable.Range(1, files)
                .Select(index => new BenchmarkFileSpec($"1-gib-{index}.bin", GB))
                .ToArray();
            runs.Add(new(
                "tune",
                $"chunk-{chunk / MB}mb-files-{files}-run-{iteration}",
                chunk,
                files,
                workload));
        }
        return runs;
    }
}
