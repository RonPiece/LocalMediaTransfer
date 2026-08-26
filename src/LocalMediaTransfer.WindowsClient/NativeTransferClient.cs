using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;

namespace LocalMediaTransfer.WindowsClient;

public sealed class NativeTransferClient
{
    private const int DefaultParallelFiles = 6;

    public static IReadOnlyList<TransferSource> PrepareFiles(IEnumerable<string> paths,
        string clientSessionId)
    {
        if (clientSessionId.Length != 36 || !clientSessionId.StartsWith("win-",
            StringComparison.Ordinal))
            throw new ArgumentException("Invalid native transfer session ID.");
        string[] selected = paths.Distinct(StringComparer.OrdinalIgnoreCase).Take(1001).ToArray();
        if (selected.Length is 0 or > 1000)
            throw new NativeClientException("invalid_file_count",
                "Select between 1 and 1,000 files.");
        var files = new List<TransferSource>(selected.Length);
        foreach (string path in selected)
        {
            var info = new FileInfo(path);
            if (!info.Exists)
                throw new NativeClientException("file_missing", $"{info.Name} no longer exists.");
            if (info.Length <= 0)
                throw new NativeClientException("zero_byte_file",
                    $"{info.Name} is empty and cannot be transferred.");
            files.Add(new TransferSource(clientSessionId + "-" +
                NativeSecurity.GenerateHex(8), info.FullName, info.Name, info.Length));
        }
        return files;
    }

    public async Task<NativeTransferSummary> SendAsync(TrustedReceiver receiver,
        IReadOnlyList<TransferSource> sources, bool skipExactDuplicates,
        IProgress<NativeTransferProgress>? progress,
        CancellationToken cancellationToken)
    {
        ValidateSources(sources);
        string clientSessionId = sources[0].FileId[..36];
        using HttpClient client = NativeSecurity.CreatePinnedClient(
            receiver.HttpsBaseUri, receiver.CertificateFingerprint);
        ClientConfiguration configuration = await NativeTransferAuthorization
            .GetConfigurationAsync(client,
            cancellationToken);
        TransferApproval approval = await NativeTransferAuthorization.RequestApprovalAsync(
            client, receiver,
            clientSessionId, sources, skipExactDuplicates, cancellationToken);
        var results = new ConcurrentDictionary<string, TransferFileResult>();
        long acknowledged = 0;
        long planned = sources.Sum(file => file.SizeBytes);
        int terminal = 0;
        double peak = 0;
        var samples = new ConcurrentQueue<(long Bytes, long Ticks)>();
        Stopwatch timer = Stopwatch.StartNew();

        void Report(TransferFileResult? file = null)
        {
            long bytes = Interlocked.Read(ref acknowledged);
            long ticks = Stopwatch.GetTimestamp();
            samples.Enqueue((bytes, ticks));
            while (samples.TryPeek(out var first) &&
                Stopwatch.GetElapsedTime(first.Ticks, ticks) > TimeSpan.FromSeconds(2))
                samples.TryDequeue(out _);
            double current = 0;
            if (samples.TryPeek(out var start))
            {
                double seconds = Stopwatch.GetElapsedTime(start.Ticks, ticks).TotalSeconds;
                if (seconds > 0.05) current = (bytes - start.Bytes) / seconds / 1_000_000d;
            }
            lock (samples) peak = Math.Max(peak, current);
            progress?.Report(new NativeTransferProgress(bytes, planned,
                Volatile.Read(ref terminal), sources.Count, current, file));
        }

        try
        {
            HashSet<string> skipped = skipExactDuplicates
                ? await NativeDuplicatePreflight.RunAsync(client, approval, sources, results,
                    () => { Interlocked.Increment(ref terminal); Report(); },
                    cancellationToken)
                : [];
            using var slots = new SemaphoreSlim(Math.Clamp(configuration.ParallelFiles,
                1, DefaultParallelFiles));
            var tasks = sources.Where(file => !skipped.Contains(file.FileId)).Select(async file =>
            {
                await slots.WaitAsync(cancellationToken);
                try
                {
                    TransferFileResult result = await NativeUploadWorker.UploadFileAsync(
                        client, approval,
                        file, configuration.ChunkSizeBytes, skipExactDuplicates,
                        bytes => { Interlocked.Add(ref acknowledged, bytes); Report(); },
                        cancellationToken);
                    results[file.FileId] = result;
                    Interlocked.Increment(ref terminal);
                    Report(result);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    results[file.FileId] = new(file.FileId, file.Name,
                        TransferFileState.Cancelled);
                    Interlocked.Increment(ref terminal);
                    throw;
                }
                catch (NativeClientException exception)
                {
                    if (IsSessionFatal(exception)) throw;
                    var failed = new TransferFileResult(file.FileId, file.Name,
                        TransferFileState.Failed, ErrorCode: exception.Code);
                    results[file.FileId] = failed;
                    Interlocked.Increment(ref terminal);
                    Report(failed);
                }
                catch (Exception exception) when (exception is IOException or
                    UnauthorizedAccessException)
                {
                    var failed = new TransferFileResult(file.FileId, file.Name,
                        TransferFileState.Failed, ErrorCode: "file_unavailable");
                    results[file.FileId] = failed;
                    Interlocked.Increment(ref terminal);
                    Report(failed);
                }
                finally { slots.Release(); }
            }).ToArray();
            await Task.WhenAll(tasks);
            double average = timer.Elapsed.TotalSeconds <= 0 ? 0 :
                Interlocked.Read(ref acknowledged) / timer.Elapsed.TotalSeconds / 1_000_000d;
            return new NativeTransferSummary(sources.Select(file =>
                results.TryGetValue(file.FileId, out TransferFileResult? result) ? result :
                new TransferFileResult(file.FileId, file.Name, TransferFileState.Failed,
                    ErrorCode: "not_processed")).ToArray(),
                Interlocked.Read(ref acknowledged), average, peak, false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return new NativeTransferSummary(sources.Select(file =>
                results.TryGetValue(file.FileId, out TransferFileResult? result) ? result :
                new TransferFileResult(file.FileId, file.Name, TransferFileState.Cancelled))
                .ToArray(), Interlocked.Read(ref acknowledged), 0, peak, true);
        }
        finally
        {
            await NativeTransferAuthorization.BestEffortCancelAsync(client, approval,
                CancellationToken.None);
        }
    }

    private static void ValidateSources(IReadOnlyList<TransferSource> sources)
    {
        if (sources.Count is 0 or > 1000) throw new NativeClientException(
            "invalid_file_count", "Select between 1 and 1,000 files.");
        if (sources.Any(file => file.SizeBytes <= 0 || file.Name.Length == 0 ||
            file.SizeBytes > 100L * 1024 * 1024 * 1024))
            throw new NativeClientException("invalid_transfer_manifest",
                "One or more selected files cannot be transferred.");
        string prefix = sources[0].FileId[..Math.Min(36, sources[0].FileId.Length)];
        if (prefix.Length != 36 || sources.Any(file =>
            !file.FileId.StartsWith(prefix + "-", StringComparison.Ordinal)))
            throw new NativeClientException("invalid_transfer_manifest",
                "File IDs are not bound to one transfer session.");
    }

    internal static bool IsRetryableStatus(HttpStatusCode status) =>
        NativeUploadWorker.IsRetryableStatus(status);

    internal static bool IsSessionFatal(NativeClientException exception) =>
        exception.Code is "tls_identity_error" or "credential_rejected" or
            "transfer_grant_rejected" or "transfer_manifest_mismatch" or
            "Unauthorized" or "Invalid token" ||
        exception.StatusCode is HttpStatusCode.Unauthorized or
            HttpStatusCode.Forbidden or HttpStatusCode.InternalServerError or
            HttpStatusCode.InsufficientStorage;
}
