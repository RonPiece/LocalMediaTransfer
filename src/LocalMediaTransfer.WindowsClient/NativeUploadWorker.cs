using System.Net;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

internal static class NativeUploadWorker
{
    private static readonly HashSet<HttpStatusCode> RetryableStatuses =
    [
        HttpStatusCode.RequestTimeout,
        HttpStatusCode.TooManyRequests,
        HttpStatusCode.InternalServerError,
        HttpStatusCode.BadGateway,
        HttpStatusCode.ServiceUnavailable,
        HttpStatusCode.GatewayTimeout
    ];

    internal static async Task<TransferFileResult> UploadFileAsync(HttpClient client,
        TransferApproval approval, TransferSource file, int chunkSize, bool skip,
        Action<long> acknowledge, CancellationToken cancellationToken)
    {
        var before = new FileInfo(file.Path);
        if (!before.Exists || before.Length != file.SizeBytes)
            throw new NativeClientException("file_changed",
                $"{file.Name} changed after it was selected.");
        int totalChunks = checked((int)((file.SizeBytes + chunkSize - 1) / chunkSize));
        using FileStream stream = new(file.Path, FileMode.Open, FileAccess.Read,
            FileShare.Read, chunkSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        byte[] buffer = new byte[chunkSize];
        string? savedName = null;
        bool skipped = false;
        for (int index = 0; index < totalChunks; index++)
        {
            int needed = (int)Math.Min(chunkSize,
                file.SizeBytes - (long)index * chunkSize);
            await stream.ReadExactlyAsync(buffer.AsMemory(0, needed), cancellationToken);
            using JsonDocument response = await SendChunkWithRetryAsync(client, approval,
                file, buffer.AsMemory(0, needed), index, totalChunks, skip,
                cancellationToken);
            acknowledge(needed);
            if (response.RootElement.TryGetProperty("filename", out JsonElement name))
                savedName = name.GetString();
            skipped = response.RootElement.TryGetProperty("skipped",
                out JsonElement wasSkipped) && wasSkipped.GetBoolean();
        }
        return new TransferFileResult(file.FileId, file.Name,
            skipped ? TransferFileState.Skipped : TransferFileState.Completed, savedName);
    }

    internal static bool IsRetryableStatus(HttpStatusCode status) =>
        RetryableStatuses.Contains(status);

    private static async Task<JsonDocument> SendChunkWithRetryAsync(HttpClient client,
        TransferApproval approval, TransferSource file, ReadOnlyMemory<byte> bytes,
        int index, int totalChunks, bool skip, CancellationToken cancellationToken)
    {
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, "/upload_chunk")
                    { Content = new ByteArrayContent(bytes.ToArray()) };
                NativeTransferProtocol.AddGrantHeaders(request, approval, skip);
                request.Headers.Add("X-File-Id", file.FileId);
                request.Headers.Add("X-Filename", Uri.EscapeDataString(file.Name));
                request.Headers.Add("X-Chunk-Index", index.ToString());
                request.Headers.Add("X-Total-Chunks", totalChunks.ToString());
                request.Headers.Add("X-File-Size", file.SizeBytes.ToString());
                HttpResponseMessage response = await client.SendAsync(request,
                    HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    using (response) return await PairingClient.ReadJsonAsync(response,
                        cancellationToken);
                }
                if (attempt >= 3 || !RetryableStatuses.Contains(response.StatusCode))
                {
                    using (response) return await PairingClient.ReadJsonAsync(response,
                        cancellationToken);
                }
                TimeSpan delay = RetryDelay(response, attempt);
                response.Dispose();
                await Task.Delay(delay, cancellationToken);
            }
            catch (HttpRequestException exception) when (
                exception.HttpRequestError == HttpRequestError.SecureConnectionError)
            {
                throw new NativeClientException("tls_identity_error",
                    "The receiver TLS identity could not be verified. Forget it and pair again.",
                    false, exception);
            }
            catch (HttpRequestException) when (attempt < 3)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(
                    250 * Math.Pow(2, attempt) + Random.Shared.Next(0, 200)),
                    cancellationToken);
            }
            catch (HttpRequestException exception)
            {
                throw new NativeClientException("network_unavailable",
                    "The receiver connection was lost after the retry limit.",
                    true, exception);
            }
        }
    }

    private static TimeSpan RetryDelay(HttpResponseMessage response, int attempt)
    {
        if (response.Headers.RetryAfter?.Delta is TimeSpan delta)
            return delta > TimeSpan.FromMinutes(1) ? TimeSpan.FromMinutes(1) : delta;
        return TimeSpan.FromMilliseconds(250 * Math.Pow(2, attempt) +
            Random.Shared.Next(0, 200));
    }
}
