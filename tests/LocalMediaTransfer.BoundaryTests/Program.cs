using System.Net.Http.Headers;
using System.Text.Json;

const int ChunkSize = 8 * 1024 * 1024;
var options = Parse(args);
using var http = new HttpClient
{
    BaseAddress = new Uri(options.Server.TrimEnd('/') + "/"),
    Timeout = Timeout.InfiniteTimeSpan
};

foreach (int sizeMb in new[] { 99, 100, 101 })
{
    long fileSize = (long)sizeMb * 1024 * 1024;
    string fileName = $"boundary-{sizeMb}mb-{Guid.NewGuid():N}.bin";
    string fileId = $"boundary-{Guid.NewGuid():N}";
    int totalChunks = checked((int)Math.Ceiling(fileSize / (double)ChunkSize));
    byte[] buffer = new byte[ChunkSize];
    string savedName = "";

    for (int chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++)
    {
        int count = (int)Math.Min(ChunkSize, fileSize - (long)chunkIndex * ChunkSize);
        Array.Clear(buffer, 0, count);
        buffer[0] = (byte)(chunkIndex % 251);
        buffer[count - 1] = (byte)((chunkIndex + 17) % 251);

        using var request = new HttpRequestMessage(HttpMethod.Post, "upload_chunk");
        request.Headers.Add("X-Upload-Token", options.Token);
        request.Headers.Add("X-File-Id", fileId);
        request.Headers.Add("X-Filename", Uri.EscapeDataString(fileName));
        request.Headers.Add("X-Chunk-Index", chunkIndex.ToString());
        request.Headers.Add("X-Total-Chunks", totalChunks.ToString());
        request.Headers.Add("X-File-Size", fileSize.ToString());
        request.Content = new ByteArrayContent(buffer, 0, count);
        request.Content.Headers.ContentType =
            new MediaTypeHeaderValue("application/octet-stream");

        using HttpResponseMessage response = await http.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Chunk {chunkIndex}/{totalChunks} for {sizeMb} MiB failed " +
                $"with HTTP {(int)response.StatusCode}: {body}");

        using JsonDocument json = JsonDocument.Parse(body);
        if (json.RootElement.TryGetProperty("filename", out JsonElement name))
            savedName = name.GetString() ?? savedName;
    }

    if (string.IsNullOrWhiteSpace(savedName))
        throw new InvalidOperationException($"{sizeMb} MiB upload did not finalize.");

    string savedPath = Path.Combine(options.UploadDirectory, savedName);
    var info = new FileInfo(savedPath);
    if (!info.Exists || info.Length != fileSize)
        throw new InvalidOperationException($"{sizeMb} MiB saved-file length mismatch.");

    await using (var stream = new FileStream(
                     savedPath,
                     FileMode.Open,
                     FileAccess.Read,
                     FileShare.Read,
                     4096,
                     FileOptions.RandomAccess))
    {
        for (int chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++)
        {
            long start = (long)chunkIndex * ChunkSize;
            long end = Math.Min(start + ChunkSize, fileSize) - 1;
            if (stream.ReadByteAt(start) != (byte)(chunkIndex % 251) ||
                stream.ReadByteAt(end) != (byte)((chunkIndex + 17) % 251))
            {
                throw new InvalidOperationException(
                    $"{sizeMb} MiB marker mismatch in chunk {chunkIndex}.");
            }
        }
    }

    File.Delete(savedPath);
    Console.WriteLine($"[PASS] {sizeMb} MiB sequential chunk boundary");
}

return 0;

static (string Server, string Token, string UploadDirectory) Parse(string[] args)
{
    string server = "";
    string token = "";
    string uploadDirectory = "";
    for (int index = 0; index < args.Length; index++)
    {
        string Next()
        {
            if (++index >= args.Length) throw new ArgumentException($"Missing value for {args[index - 1]}");
            return args[index];
        }

        switch (args[index])
        {
            case "--server": server = Next(); break;
            case "--token": token = Next(); break;
            case "--upload-dir": uploadDirectory = Path.GetFullPath(Next()); break;
            default: throw new ArgumentException($"Unknown argument: {args[index]}");
        }
    }

    if (string.IsNullOrWhiteSpace(server) ||
        string.IsNullOrWhiteSpace(token) ||
        string.IsNullOrWhiteSpace(uploadDirectory))
    {
        throw new ArgumentException("--server, --token, and --upload-dir are required.");
    }
    return (server, token, uploadDirectory);
}

file static class FileStreamExtensions
{
    public static byte ReadByteAt(this FileStream stream, long offset)
    {
        stream.Position = offset;
        int value = stream.ReadByte();
        if (value < 0) throw new EndOfStreamException();
        return (byte)value;
    }
}
