using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;

namespace LocalMediaTransfer.Benchmarks;

internal sealed class BenchmarkClient : IDisposable
{
    private const long SingleFileThreshold = 100L * 1024 * 1024;
    private readonly HttpClient _http;
    private readonly string _token;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    private long _transferredBytes;

    public BenchmarkClient(Uri server, string token, string certificateFingerprint)
    {
        _token = token;
        HttpMessageHandler handler = new HttpClientHandler();
        if (server.Scheme == Uri.UriSchemeHttps)
        {
            byte[] expected = Convert.FromHexString(certificateFingerprint);
            var pinnedHandler = new HttpClientHandler();
            pinnedHandler.ServerCertificateCustomValidationCallback = (_, certificate, _, _) =>
                certificate != null && CryptographicOperations.FixedTimeEquals(
                    SHA256.HashData(certificate.RawData), expected);
            handler = pinnedHandler;
        }
        _http = new HttpClient(handler)
        {
            BaseAddress = server,
            Timeout = Timeout.InfiniteTimeSpan
        };
    }

    public long TransferredBytes => Interlocked.Read(ref _transferredBytes);

    public async Task<string> StartRunAsync(
        StartRunRequest request,
        CancellationToken cancellationToken)
    {
        using HttpResponseMessage response = await SendJsonAsync(
            HttpMethod.Post,
            "_dev/benchmark/runs/start",
            request,
            cancellationToken);
        await EnsureSuccessAsync(response);
        StartRunResponse? payload = await ReadJsonAsync<StartRunResponse>(
            response,
            cancellationToken);
        if (string.IsNullOrWhiteSpace(payload?.RunId))
            throw new InvalidOperationException("Benchmark server did not return a run ID.");
        return payload.RunId;
    }

    public async Task<IReadOnlyList<UploadedFile>> UploadFilesAsync(
        IReadOnlyList<GeneratedFile> files,
        long chunkSizeBytes,
        int fileConcurrency,
        CancellationToken cancellationToken)
    {
        using var gate = new SemaphoreSlim(fileConcurrency);
        Task<UploadedFile>[] tasks = files.Select(async (file, index) =>
        {
            await gate.WaitAsync(cancellationToken);
            try
            {
                return await UploadOneAsync(
                    $"{index + 1:D4}-{Guid.NewGuid():N}",
                    file,
                    chunkSizeBytes,
                    cancellationToken);
            }
            finally
            {
                gate.Release();
            }
        }).ToArray();

        return await Task.WhenAll(tasks);
    }

    public async Task<IReadOnlyList<UploadResult>> VerifyFilesAsync(
        string runId,
        IReadOnlyList<UploadedFile> uploads,
        CancellationToken cancellationToken)
    {
        var results = new List<UploadResult>(uploads.Count);
        foreach (UploadedFile upload in uploads)
        {
            bool integrityOk = false;
            string error = upload.Error;
            var verifyPayload = new
            {
                sourceName = upload.Source.Name,
                savedName = upload.SavedName,
                sizeBytes = upload.Source.SizeBytes,
                uploadMode = upload.UploadMode,
                durationMs = upload.DurationMs,
                throughputMBps = upload.ThroughputMBps,
                retries = upload.Retries,
                httpStatus = upload.HttpStatus,
                expectedSha256 = upload.Source.Sha256,
                error
            };

            using (HttpResponseMessage response = await SendJsonAsync(
                       HttpMethod.Post,
                       $"_dev/benchmark/runs/{runId}/files/{upload.FileId}/verify",
                       verifyPayload,
                       cancellationToken))
            {
                integrityOk = response.IsSuccessStatusCode && string.IsNullOrEmpty(error);
                if (!response.IsSuccessStatusCode && string.IsNullOrEmpty(error))
                    error = await response.Content.ReadAsStringAsync(cancellationToken);
            }

            results.Add(new(
                upload.FileId,
                upload.Source.Name,
                upload.SavedName,
                upload.Source.SizeBytes,
                upload.UploadMode,
                upload.DurationMs,
                upload.ThroughputMBps,
                upload.Retries,
                upload.HttpStatus,
                upload.Source.Sha256,
                integrityOk,
                error));
        }
        return results;
    }

    public async Task AddSampleAsync(
        string runId,
        BenchmarkSample sample,
        CancellationToken cancellationToken)
    {
        using HttpResponseMessage response = await SendJsonAsync(
            HttpMethod.Post,
            $"_dev/benchmark/runs/{runId}/samples",
            sample,
            cancellationToken);
        await EnsureSuccessAsync(response);
    }

    public async Task FinishRunAsync(
        string runId,
        FinishRunRequest request,
        CancellationToken cancellationToken)
    {
        using HttpResponseMessage response = await SendJsonAsync(
            HttpMethod.Post,
            $"_dev/benchmark/runs/{runId}/finish",
            request,
            cancellationToken);
        await EnsureSuccessAsync(response);
    }

    public async Task<string> GetRunJsonAsync(
        string runId,
        CancellationToken cancellationToken)
    {
        using var request = CreateRequest(
            HttpMethod.Get,
            $"_dev/benchmark/runs/{runId}");
        using HttpResponseMessage response = await _http.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response);
        return await response.Content.ReadAsStringAsync(cancellationToken);
    }

    private async Task<UploadedFile> UploadOneAsync(
        string fileId,
        GeneratedFile file,
        long chunkSizeBytes,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        string mode = file.SizeBytes > SingleFileThreshold ? "chunked" : "multipart";
        string savedName = "";
        int retries = 0;
        int status = 0;
        string error = "";

        try
        {
            (savedName, status, retries) = mode == "chunked"
                ? await UploadChunkedAsync(fileId, file, chunkSizeBytes, cancellationToken)
                : await UploadMultipartAsync(file, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (UploadFailureException ex)
        {
            status = ex.StatusCode;
            retries = ex.Retries;
            error = ex.Message;
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }
        stopwatch.Stop();

        double throughput = string.IsNullOrEmpty(error) && stopwatch.Elapsed.TotalSeconds > 0
            ? file.SizeBytes / 1_000_000d / stopwatch.Elapsed.TotalSeconds
            : 0;
        return new(
            fileId,
            file,
            savedName,
            mode,
            stopwatch.ElapsedMilliseconds,
            throughput,
            retries,
            status,
            error);
    }

    private async Task<(string SavedName, int Status, int Retries)> UploadMultipartAsync(
        GeneratedFile file,
        CancellationToken cancellationToken)
    {
        await using var input = new FileStream(
            file.Path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var counted = new CountingStream(
            input,
            count => Interlocked.Add(ref _transferredBytes, count));
        using var fileContent = new StreamContent(counted, 1024 * 1024);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var multipart = new MultipartFormDataContent();
        multipart.Add(fileContent, "file", file.Name);
        using var request = CreateRequest(HttpMethod.Post, "upload_single");
        request.Headers.Add("X-Filename", Uri.EscapeDataString(file.Name));
        request.Content = multipart;

        using HttpResponseMessage response = await _http.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        string body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new UploadFailureException(
                (int)response.StatusCode,
                0,
                $"Multipart upload failed ({(int)response.StatusCode}): {body}");
        }

        using JsonDocument document = JsonDocument.Parse(body);
        string savedName = document.RootElement.GetProperty("filename").GetString() ?? "";
        return (savedName, (int)response.StatusCode, 0);
    }

    private async Task<(string SavedName, int Status, int Retries)> UploadChunkedAsync(
        string fileId,
        GeneratedFile file,
        long chunkSizeBytes,
        CancellationToken cancellationToken)
    {
        int totalChunks = checked((int)Math.Ceiling(file.SizeBytes / (double)chunkSizeBytes));
        byte[] buffer = new byte[checked((int)Math.Min(chunkSizeBytes, int.MaxValue))];
        int retries = 0;
        int status = 0;
        string savedName = "";

        await using var input = new FileStream(
            file.Path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        for (int chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++)
        {
            int expected = (int)Math.Min(buffer.Length, file.SizeBytes - input.Position);
            int read = 0;
            while (read < expected)
            {
                int count = await input.ReadAsync(
                    buffer.AsMemory(read, expected - read),
                    cancellationToken);
                if (count == 0) throw new EndOfStreamException(file.Path);
                read += count;
            }

            for (int attempt = 0; ; attempt++)
            {
                using var request = CreateRequest(HttpMethod.Post, "upload_chunk");
                request.Headers.Add("X-File-Id", fileId);
                request.Headers.Add("X-Filename", Uri.EscapeDataString(file.Name));
                request.Headers.Add("X-Chunk-Index", chunkIndex.ToString());
                request.Headers.Add("X-Total-Chunks", totalChunks.ToString());
                request.Headers.Add("X-File-Size", file.SizeBytes.ToString());
                request.Content = new ByteArrayContent(buffer, 0, read);
                request.Content.Headers.ContentType =
                    new MediaTypeHeaderValue("application/octet-stream");

                try
                {
                    using HttpResponseMessage response = await _http.SendAsync(
                        request,
                        HttpCompletionOption.ResponseHeadersRead,
                        cancellationToken);
                    string body = await response.Content.ReadAsStringAsync(cancellationToken);
                    status = (int)response.StatusCode;
                    if (!response.IsSuccessStatusCode)
                        throw new HttpRequestException($"Chunk {chunkIndex} failed ({status}): {body}");

                    Interlocked.Add(ref _transferredBytes, read);
                    using JsonDocument document = JsonDocument.Parse(body);
                    if (document.RootElement.TryGetProperty("filename", out JsonElement filename))
                        savedName = filename.GetString() ?? savedName;
                    break;
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception) when (attempt < 2)
                {
                    retries++;
                    await Task.Delay(TimeSpan.FromMilliseconds(300 * (attempt + 1)), cancellationToken);
                }
                catch (Exception ex)
                {
                    throw new UploadFailureException(status, retries, ex.Message, ex);
                }
            }
        }

        return (savedName, status, retries);
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Upload-Token", _token);
        return request;
    }

    private async Task<HttpResponseMessage> SendJsonAsync<T>(
        HttpMethod method,
        string path,
        T payload,
        CancellationToken cancellationToken)
    {
        var request = CreateRequest(method, path);
        request.Content = new StringContent(
            JsonSerializer.Serialize(payload, _json),
            Encoding.UTF8,
            "application/json");
        HttpResponseMessage response = await _http.SendAsync(request, cancellationToken);
        request.Dispose();
        return response;
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        string body = await response.Content.ReadAsStringAsync();
        throw new HttpRequestException(
            $"Server returned {(int)response.StatusCode} {response.StatusCode}: {body}");
    }

    private async Task<T?> ReadJsonAsync<T>(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        await using Stream stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return await JsonSerializer.DeserializeAsync<T>(stream, _json, cancellationToken);
    }

    public void Dispose() => _http.Dispose();

    private sealed class UploadFailureException(
        int statusCode,
        int retries,
        string message,
        Exception? innerException = null) : Exception(message, innerException)
    {
        public int StatusCode { get; } = statusCode;
        public int Retries { get; } = retries;
    }

    private sealed class CountingStream(Stream inner, Action<int> onRead) : Stream
    {
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => inner.CanSeek;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override void Flush() => inner.Flush();
        public override int Read(byte[] buffer, int offset, int count)
        {
            int read = inner.Read(buffer, offset, count);
            if (read > 0) onRead(read);
            return read;
        }
        public override async ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            int read = await inner.ReadAsync(buffer, cancellationToken);
            if (read > 0) onRead(read);
            return read;
        }
        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) =>
            throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if (disposing) inner.Dispose();
            base.Dispose(disposing);
        }
        public override async ValueTask DisposeAsync()
        {
            await inner.DisposeAsync();
            GC.SuppressFinalize(this);
        }
    }
}
