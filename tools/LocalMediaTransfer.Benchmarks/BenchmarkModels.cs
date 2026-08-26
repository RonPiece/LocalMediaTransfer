using System.Text.Json.Serialization;

namespace LocalMediaTransfer.Benchmarks;

internal sealed record BenchmarkFileSpec(string Name, long SizeBytes);

internal sealed record BenchmarkRunSpec(
    string Profile,
    string Label,
    long ChunkSizeBytes,
    int FileConcurrency,
    IReadOnlyList<BenchmarkFileSpec> Files,
    bool IsWarmup = false);

internal sealed record GeneratedFile(
    string Path,
    string Name,
    long SizeBytes,
    string Sha256);

internal sealed record UploadedFile(
    string FileId,
    GeneratedFile Source,
    string SavedName,
    string UploadMode,
    long DurationMs,
    double ThroughputMBps,
    int Retries,
    int HttpStatus,
    string Error);

internal sealed record UploadResult(
    string FileId,
    string SourceName,
    string SavedName,
    long SizeBytes,
    string UploadMode,
    long DurationMs,
    double ThroughputMBps,
    int Retries,
    int HttpStatus,
    string ExpectedSha256,
    bool IntegrityOk,
    string Error);

internal sealed record BenchmarkSample(
    long ElapsedMs,
    double ThroughputMBps,
    double CpuPercent,
    long WorkingSetBytes,
    long ProcessIoReadBytes,
    long ProcessIoWriteBytes,
    long NetworkBytes,
    long TransferredBytes);

internal sealed record MachineMetadata(
    string Fingerprint,
    string OsName,
    string OsVersion,
    string CpuName,
    int PhysicalCores,
    int LogicalCores,
    long RamBytes,
    string NicName,
    double NicLinkMbps,
    string StorageModel,
    string StorageType);

internal sealed record StartRunRequest(
    MachineMetadata Machine,
    string GitCommit,
    string ServerVersion,
    string ClientVersion,
    string BuildConfiguration,
    string Profile,
    string Transport,
    long ChunkSizeBytes,
    int FileConcurrency,
    double NetworkBaselineMbps,
    string Notes);

internal sealed record FinishRunRequest(
    long TotalBytes,
    int TotalFiles,
    long DurationMs,
    double AverageMBps,
    double PeakMBps,
    double P50MBps,
    double P95MBps,
    double P99MBps,
    int Retries,
    int Errors,
    bool IntegrityOk,
    string Notes,
    string Status = "completed");

internal sealed class StartRunResponse
{
    [JsonPropertyName("runId")]
    public string RunId { get; set; } = "";
}
