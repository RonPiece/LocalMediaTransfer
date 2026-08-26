namespace LocalMediaTransfer.NativeWindowsAcceptance;

public enum AcceptanceRole
{
    Sender,
    Receiver
}

public sealed record AcceptanceOptions(
    AcceptanceRole Role,
    string Environment,
    string? ManualAddress,
    string ReportPath,
    string ReceiverLogPath,
    int DurationMinutes,
    int LargeFileMiB,
    int CancelAfterMiB,
    int RestartAfterMiB,
    bool KeepSourceFiles)
{
    public int DiscoveryPort => Environment == "test" ? 45893 : 45892;
    public int HttpsPort => Environment == "test" ? 18443 : 8443;

    public static AcceptanceOptions Parse(IEnumerable<string> arguments)
    {
        string[] args = arguments.ToArray();
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int index = 0; index < args.Length; index++)
        {
            string argument = args[index];
            if (argument is "--confirm-two-pc" or "--keep-source-files")
            {
                flags.Add(argument);
                continue;
            }
            if (!argument.StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length)
                throw new AcceptanceOptionException($"Unknown or incomplete option '{argument}'.");
            values[argument] = args[++index];
        }

        if (!flags.Contains("--confirm-two-pc"))
            throw new AcceptanceOptionException(
                "This runner is opt-in. Supply --confirm-two-pc after reading the two-PC guide.");
        string roleText = Required(values, "--role");
        AcceptanceRole role = roleText.ToLowerInvariant() switch
        {
            "sender" => AcceptanceRole.Sender,
            "receiver" => AcceptanceRole.Receiver,
            _ => throw new AcceptanceOptionException("--role must be sender or receiver.")
        };
        string environment = values.GetValueOrDefault("--environment", "production")
            .ToLowerInvariant();
        if (environment is not ("production" or "test"))
            throw new AcceptanceOptionException("--environment must be production or test.");

        int duration = Positive(values, "--duration-minutes", 60, 1, 240);
        int largeFile = Positive(values, "--large-file-mib", 512, 64, 4096);
        int cancelAfter = Positive(values, "--cancel-after-mib", 16, 8, largeFile - 8);
        int restartAfter = Positive(values, "--restart-after-mib", 16, 8, largeFile - 8);
        string timestamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmssZ");
        string report = Path.GetFullPath(values.GetValueOrDefault("--report",
            Path.Combine("artifacts", "native-windows-acceptance",
                $"{timestamp}-{roleText.ToLowerInvariant()}.json")));
        string dataDirectory = environment == "test"
            ? "LocalMediaTransfer.Test" : "LocalMediaTransfer";
        string receiverLog = Path.GetFullPath(values.GetValueOrDefault("--receiver-log",
            Path.Combine(System.Environment.GetFolderPath(
                System.Environment.SpecialFolder.LocalApplicationData),
                dataDirectory, "logs", "server.log")));

        return new AcceptanceOptions(role, environment,
            values.GetValueOrDefault("--manual"), report, receiverLog, duration,
            largeFile, cancelAfter, restartAfter,
            flags.Contains("--keep-source-files"));
    }

    public static void WriteUsage(TextWriter writer)
    {
        writer.WriteLine("Native Windows two-PC acceptance runner");
        writer.WriteLine();
        writer.WriteLine("Receiver diagnostics:");
        writer.WriteLine("  dotnet run --project tools/LocalMediaTransfer.NativeWindowsAcceptance -- --role receiver --confirm-two-pc");
        writer.WriteLine();
        writer.WriteLine("Sender acceptance:");
        writer.WriteLine("  dotnet run --project tools/LocalMediaTransfer.NativeWindowsAcceptance -- --role sender --confirm-two-pc [--manual 192.168.1.20:8443]");
        writer.WriteLine();
        writer.WriteLine("Options: --environment production|test, --report PATH,");
        writer.WriteLine("  --receiver-log PATH, --duration-minutes 1..240,");
        writer.WriteLine("  --large-file-mib 64..4096, --cancel-after-mib N,");
        writer.WriteLine("  --restart-after-mib N, --keep-source-files");
    }

    private static string Required(IReadOnlyDictionary<string, string> values, string name) =>
        values.TryGetValue(name, out string? value) && !string.IsNullOrWhiteSpace(value)
            ? value : throw new AcceptanceOptionException($"{name} is required.");

    private static int Positive(IReadOnlyDictionary<string, string> values, string name,
        int defaultValue, int minimum, int maximum)
    {
        if (!values.TryGetValue(name, out string? text)) return defaultValue;
        if (!int.TryParse(text, out int value) || value < minimum || value > maximum)
            throw new AcceptanceOptionException(
                $"{name} must be between {minimum} and {maximum}.");
        return value;
    }
}

public sealed class AcceptanceOptionException(string message) : Exception(message);
