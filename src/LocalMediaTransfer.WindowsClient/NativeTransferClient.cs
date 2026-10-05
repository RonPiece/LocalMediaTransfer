using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;

namespace LocalMediaTransfer.WindowsClient;

public sealed class NativeTransferClient
{
    private const int DefaultParallelFiles = 6;

    public static long MaximumFileBytes(int chunkSizeBytes)
    {
        if (chunkSizeBytes <= 0) throw new ArgumentOutOfRangeException(nameof(chunkSizeBytes));
        return Math.Min(TransferLimits.MaxFileBytes, (long)TransferLimits.MaxChunksPerFile * chunkSizeBytes);
    }

    public static IReadOnlyList<TransferSource> PrepareFiles(IEnumerable<string> paths,
        string clientSessionId)
    {
        if (clientSessionId.Length != 36 || !clientSessionId.StartsWith("win-",
            StringComparison.Ordinal))
            throw new ArgumentException("Invalid native transfer session ID.");
        string[] selected = paths.Distinct(StringComparer.OrdinalIgnoreCase).Take(TransferLimits.MaxQueuedFiles + 1).ToArray();
        if (selected.Length is 0 or > TransferLimits.MaxQueuedFiles)
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
        if (sources.Any(file => file.SizeBytes > MaximumFileBytes(configuration.ChunkSizeBytes)))
            throw new NativeClientException("file_too_large",
                "A selected file exceeds the receiver's 10,000-chunk limit. Split it before sending.", false);
        TransferApproval approval = await NativeTransferAuthorization.RequestApprovalAsync(
            client, receiver,
            clientSessionId, sources, skipExactDuplicates, cancellationToken);
        var telemetry = new NativeTransferTelemetry(client, receiver.Credential, clientSessionId);
        await telemetry.StartAsync();
        var results = new ConcurrentDictionary<string, TransferFileResult>();
        long planned = sources.Sum(file => file.SizeBytes);
        int terminal = 0;
        Stopwatch timer = Stopwatch.StartNew();
        var rate = new NativeTransferRateTracker(Stopwatch.GetTimestamp());
        string outcome = "transfer_failed";

        void Report(TransferFileResult? file = null, long newlyAcknowledged = 0)
        {
            long bytes;
            double current;
            lock (rate)
            {
                long ticks = Stopwatch.GetTimestamp();
                if (newlyAcknowledged > 0) rate.Acknowledge(newlyAcknowledged, ticks);
                bytes = rate.AcknowledgedBytes;
                current = rate.CurrentMBps(ticks);
            }
            telemetry.RecordCurrentMediaRate(current);
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
            TransferSource[] pending = sources
                .Where(file => !skipped.Contains(file.FileId)).ToArray();
            await using var displayTimer = new Timer(_ => Report(), null, 1000, 1000);
            await BoundedWorkerPool.RunAsync(pending,
                Math.Clamp(configuration.ParallelFiles, 1, DefaultParallelFiles),
                async (_, file, workerToken) =>
                {
                    try
                    {
                        TransferFileResult result = await NativeUploadWorker.UploadFileAsync(
                            client, approval,
                            file, configuration.ChunkSizeBytes, skipExactDuplicates,
                            bytes => Report(newlyAcknowledged: bytes),
                            workerToken);
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
                },
                exception => exception is NativeClientException native && IsSessionFatal(native),
                cancellationToken);
            double average = timer.Elapsed.TotalSeconds <= 0 ? 0 :
                rate.AcknowledgedBytes / timer.Elapsed.TotalSeconds / 1_000_000d;
            outcome = "transfer_completed";
            return new NativeTransferSummary(sources.Select(file =>
                results.TryGetValue(file.FileId, out TransferFileResult? result) ? result :
                new TransferFileResult(file.FileId, file.Name, TransferFileState.Failed,
                    ErrorCode: "not_processed")).ToArray(),
                rate.AcknowledgedBytes, average, rate.PeakMBps, false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            outcome = "transfer_cancelled";
            return new NativeTransferSummary(sources.Select(file =>
                results.TryGetValue(file.FileId, out TransferFileResult? result) ? result :
                new TransferFileResult(file.FileId, file.Name, TransferFileState.Cancelled))
                .ToArray(), rate.AcknowledgedBytes, 0, rate.PeakMBps, true);
        }
        finally
        {
            try
            {
                await telemetry.FinishAsync(outcome);
            }
            finally
            {
                await NativeTransferAuthorization.BestEffortCancelAsync(client, approval,
                    CancellationToken.None);
            }
        }
    }

    private static void ValidateSources(IReadOnlyList<TransferSource> sources)
    {
        if (sources.Count is 0 or > TransferLimits.MaxQueuedFiles) throw new NativeClientException(
            "invalid_file_count", "Select between 1 and 1,000 files.");
        if (sources.Any(file => file.SizeBytes <= 0 || file.Name.Length == 0 ||
            file.SizeBytes > TransferLimits.MaxFileBytes))
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
