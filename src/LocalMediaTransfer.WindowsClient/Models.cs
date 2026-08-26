namespace LocalMediaTransfer.WindowsClient;

public sealed record NativeCapability(int Version, bool PairingAvailable);

public sealed record DiscoveredReceiver(
    string ServerId,
    string Name,
    string Environment,
    string Address,
    int HttpsPort,
    string AdvertisedCertificateFingerprint,
    NativeCapability? NativeWindows,
    int? HttpPort = null)
{
    public Uri HttpsBaseUri => new($"https://{Address}:{HttpsPort}");
    public bool SupportsNativeWindows => NativeWindows?.Version == 1;
}

public sealed record TrustedReceiver(
    string ServerId,
    string Name,
    string Environment,
    string Address,
    int HttpsPort,
    string CertificateFingerprint,
    string Credential,
    DateTimeOffset LastSeen)
{
    public Uri HttpsBaseUri => new($"https://{Address}:{HttpsPort}");
}

public sealed record PairingSession(
    DiscoveredReceiver Receiver,
    string ClientId,
    string Credential,
    string ClientNonce,
    string RequestId,
    string ObservedFingerprint,
    string SecurityCode);

public sealed record TransferSource(
    string FileId,
    string Path,
    string Name,
    long SizeBytes);

public enum TransferFileState
{
    Queued,
    Checking,
    Ready,
    Uploading,
    Skipped,
    Completed,
    Failed,
    Cancelled
}

public sealed record TransferFileResult(
    string FileId,
    string Name,
    TransferFileState State,
    string? SavedName = null,
    string? ErrorCode = null);

public sealed record NativeTransferProgress(
    long AcknowledgedBytes,
    long PlannedBytes,
    int TerminalFiles,
    int TotalFiles,
    double CurrentMBps,
    TransferFileResult? File);

public sealed record NativeTransferSummary(
    IReadOnlyList<TransferFileResult> Files,
    long AcknowledgedBytes,
    double AverageMBps,
    double PeakMBps,
    bool Cancelled);

public sealed class NativeClientException : Exception
{
    public NativeClientException(string code, string message, bool retryable = false,
        Exception? innerException = null, System.Net.HttpStatusCode? statusCode = null,
        TimeSpan? retryAfter = null) : base(message, innerException)
    {
        Code = code;
        Retryable = retryable;
        StatusCode = statusCode;
        RetryAfter = retryAfter;
    }

    public string Code { get; }
    public bool Retryable { get; }
    public System.Net.HttpStatusCode? StatusCode { get; }
    public TimeSpan? RetryAfter { get; }
}
