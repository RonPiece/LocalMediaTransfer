using System.Text.Json;
using LocalMediaTransfer.WindowsClient;

namespace LocalMediaTransfer.NativeWindowsAcceptance;

public sealed record AcceptanceDiagnosticEntry(
    DateTimeOffset TimestampUtc,
    string Stage,
    string Outcome,
    string? ErrorCode = null,
    int? FileCount = null,
    long? ByteCount = null);

public sealed class AcceptanceDiagnosticReport
{
    private readonly object _gate = new();
    private readonly List<AcceptanceDiagnosticEntry> _entries = [];

    public AcceptanceDiagnosticReport(string role, string environment)
    {
        Role = role;
        Environment = environment;
        StartedUtc = DateTimeOffset.UtcNow;
    }

    public int SchemaVersion => 1;
    public string Role { get; }
    public string Environment { get; }
    public DateTimeOffset StartedUtc { get; }
    public DateTimeOffset? FinishedUtc { get; private set; }
    public string Outcome { get; private set; } = "running";
    public IReadOnlyList<AcceptanceDiagnosticEntry> Entries
    {
        get { lock (_gate) return _entries.ToArray(); }
    }

    public void Record(string stage, string outcome, string? errorCode = null,
        int? fileCount = null, long? byteCount = null)
    {
        lock (_gate)
        {
            _entries.Add(new AcceptanceDiagnosticEntry(DateTimeOffset.UtcNow,
                SanitizeLabel(stage, "unknown_stage"),
                SanitizeLabel(outcome, "unknown_outcome"),
                SanitizeErrorCode(errorCode), fileCount, byteCount));
        }
    }

    public void Finish(string outcome)
    {
        Outcome = outcome;
        FinishedUtc = DateTimeOffset.UtcNow;
    }

    public async Task SaveAsync(string path, CancellationToken cancellationToken = default)
    {
        string fullPath = Path.GetFullPath(path);
        string? directory = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrEmpty(directory))
            throw new InvalidOperationException("The diagnostic report path has no directory.");
        Directory.CreateDirectory(directory);
        string temporary = fullPath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await using (FileStream stream = new(temporary, FileMode.CreateNew,
                FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous))
            {
                await JsonSerializer.SerializeAsync(stream, new
                {
                    schemaVersion = SchemaVersion,
                    role = Role,
                    environment = Environment,
                    startedUtc = StartedUtc,
                    finishedUtc = FinishedUtc,
                    outcome = Outcome,
                    entries = Entries
                }, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
            }
            File.Move(temporary, fullPath, true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public static string ErrorCode(Exception exception) => exception switch
    {
        NativeClientException native => SanitizeErrorCode(native.Code) ?? "native_client_error",
        OperationCanceledException => "cancelled",
        IOException => "local_io_error",
        UnauthorizedAccessException => "local_access_denied",
        _ => "unexpected_error"
    };

    private static string? SanitizeErrorCode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (value is "cancelled" or "Unauthorized") return value;
        if (value.Length > 64 || !value.Contains('_') ||
            value.Any(character => !(character is >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')))
            return "native_client_error";
        return value;
    }

    private static string SanitizeLabel(string value, string fallback)
    {
        if (value.Length is < 1 or > 64 || value.Any(character =>
            !(character is >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')))
            return fallback;
        return value;
    }
}

public static class ReceiverDiagnosticParser
{
    public const string Marker = "[native_windows_diagnostic] ";
    private static readonly HashSet<string> AllowedEvents = new(StringComparer.Ordinal)
    {
        "receiver_server_started",
        "pairing_window_opened",
        "pairing_window_closed",
        "pairing_requested",
        "pairing_confirmed",
        "pairing_approved",
        "pairing_denied",
        "pairing_expired",
        "transfer_requested",
        "transfer_approved",
        "transfer_denied",
        "transfer_cancelled",
        "transfer_expired",
        "device_revoked",
        "all_devices_revoked"
    };

    public static bool TryParse(string line, out AcceptanceDiagnosticEntry? entry)
    {
        entry = null;
        int marker = line.IndexOf(Marker, StringComparison.Ordinal);
        if (marker < 0) return false;
        try
        {
            using JsonDocument json = JsonDocument.Parse(line[(marker + Marker.Length)..]);
            JsonElement root = json.RootElement;
            string? eventName = root.TryGetProperty("event", out JsonElement eventValue)
                ? eventValue.GetString() : null;
            if (eventName is null || !AllowedEvents.Contains(eventName)) return false;
            int? fileCount = root.TryGetProperty("fileCount", out JsonElement files) &&
                files.TryGetInt32(out int parsedFiles) && parsedFiles is >= 0 and <= 1000
                    ? parsedFiles : null;
            long? byteCount = root.TryGetProperty("totalBytes", out JsonElement bytes) &&
                bytes.TryGetInt64(out long parsedBytes) && parsedBytes >= 0
                    ? parsedBytes : null;
            entry = new AcceptanceDiagnosticEntry(DateTimeOffset.UtcNow,
                eventName, "observed", null, fileCount, byteCount);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
