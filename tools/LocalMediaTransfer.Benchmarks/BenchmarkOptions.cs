namespace LocalMediaTransfer.Benchmarks;

internal sealed class BenchmarkOptions
{
    public Uri Server { get; private set; } = new("http://127.0.0.1:8080");
    public string Token { get; private set; } =
        Environment.GetEnvironmentVariable("LMT_BENCHMARK_TOKEN") ?? "";
    public string CertificateFingerprint { get; private set; } =
        Environment.GetEnvironmentVariable("LMT_BENCHMARK_TLS_FINGERPRINT") ?? "";
    public string Profile { get; private set; } = "smoke";
    public long ChunkSizeBytes { get; private set; } = 32L * 1024 * 1024;
    public int FileConcurrency { get; private set; } = 1;
    public int? Iterations { get; private set; }
    public string Transport { get; private set; } = "ethernet";
    public string Notes { get; private set; } = "";
    public string BuildConfiguration { get; private set; } = "Release";
    public double NetworkBaselineMbps { get; private set; }
    public bool KeepFiles { get; private set; }
    public string ExportDirectory { get; private set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "LocalMediaTransfer",
        "benchmarks",
        "exports");
    public bool ShowHelp { get; private set; }

    public static BenchmarkOptions Parse(string[] args)
    {
        var options = new BenchmarkOptions();
        for (var index = 0; index < args.Length; index++)
        {
            string Next(string name)
            {
                if (++index >= args.Length)
                    throw new ArgumentException($"{name} requires a value.");
                return args[index];
            }

            switch (args[index])
            {
                case "--server":
                    options.Server = new Uri(Next("--server").TrimEnd('/') + "/");
                    break;
                case "--token":
                    options.Token = Next("--token");
                    break;
                case "--certificate-fingerprint":
                    options.CertificateFingerprint = Next("--certificate-fingerprint");
                    break;
                case "--profile":
                    options.Profile = Next("--profile").ToLowerInvariant();
                    break;
                case "--chunk-size-mb":
                    options.ChunkSizeBytes = ParsePositiveLong(Next("--chunk-size-mb"), "--chunk-size-mb") * 1024 * 1024;
                    break;
                case "--file-concurrency":
                    options.FileConcurrency = ParsePositiveInt(Next("--file-concurrency"), "--file-concurrency");
                    break;
                case "--iterations":
                    options.Iterations = ParsePositiveInt(Next("--iterations"), "--iterations");
                    break;
                case "--transport":
                    options.Transport = Next("--transport");
                    break;
                case "--notes":
                    options.Notes = Next("--notes");
                    break;
                case "--build-configuration":
                    options.BuildConfiguration = Next("--build-configuration");
                    break;
                case "--network-baseline-mbps":
                    options.NetworkBaselineMbps = double.Parse(
                        Next("--network-baseline-mbps"),
                        System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case "--export-dir":
                    options.ExportDirectory = Path.GetFullPath(Next("--export-dir"));
                    break;
                case "--keep-files":
                    options.KeepFiles = true;
                    break;
                case "--help":
                case "-h":
                    options.ShowHelp = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown argument: {args[index]}");
            }
        }

        if (!options.ShowHelp &&
            !new[] { "smoke", "standard", "soak", "tune", "manual" }.Contains(options.Profile))
        {
            throw new ArgumentException($"Unknown profile: {options.Profile}");
        }

        if (!options.ShowHelp && string.IsNullOrWhiteSpace(options.Token))
        {
            throw new ArgumentException(
                "A token is required. Set LMT_BENCHMARK_TOKEN or pass --token.");
        }
        options.CertificateFingerprint = new string(options.CertificateFingerprint
            .Where(Uri.IsHexDigit).Select(char.ToLowerInvariant).ToArray());
        if (!options.ShowHelp && options.Server.Scheme == Uri.UriSchemeHttps &&
            options.CertificateFingerprint.Length != 64)
            throw new ArgumentException("HTTPS benchmarks require a 64-character --certificate-fingerprint.");

        return options;
    }

    private static int ParsePositiveInt(string value, string name)
    {
        if (!int.TryParse(value, out int parsed) || parsed <= 0)
            throw new ArgumentException($"{name} must be a positive integer.");
        return parsed;
    }

    private static long ParsePositiveLong(string value, string name)
    {
        if (!long.TryParse(value, out long parsed) || parsed <= 0)
            throw new ArgumentException($"{name} must be a positive integer.");
        return parsed;
    }

    public static void PrintHelp()
    {
        Console.WriteLine("""
LocalMediaTransfer.Benchmarks

Required:
  --token <token>                 Upload token (or LMT_BENCHMARK_TOKEN)

Options:
  --server <url>                  Server base URL (default http://127.0.0.1:8080)
  --certificate-fingerprint <sha256> Required for pinned HTTPS
  --profile <name>                smoke, standard, soak, tune, or manual
  --chunk-size-mb <n>             Chunk size for smoke/standard/soak
  --file-concurrency <n>          Concurrent files (chunks remain sequential per file)
  --iterations <n>                Override measured iteration count
  --transport <label>             ethernet, wifi, loopback, etc.
  --network-baseline-mbps <n>     Optional iperf3 baseline in Mbps
  --notes <text>                  Notes stored with the run
  --build-configuration <name>    Release or Debug metadata
  --export-dir <path>             JSON/CSV output directory
  --keep-files                    Keep generated source files
  --help                          Show this help
""");
    }
}
