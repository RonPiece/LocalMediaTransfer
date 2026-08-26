using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

internal static class NativeDuplicatePreflight
{
    internal static async Task<HashSet<string>> RunAsync(HttpClient client,
        TransferApproval approval, IReadOnlyList<TransferSource> sources,
        ConcurrentDictionary<string, TransferFileResult> results,
        Action terminal, CancellationToken cancellationToken)
    {
        using JsonDocument initial = await NativeTransferProtocol.PostJsonAsync(client,
            "/upload/preflight", new { files = sources.Select(file => new
            {
                id = file.FileId,
                name = file.Name,
                size = file.SizeBytes
            }) }, approval, true, cancellationToken);
        HashSet<string> candidates = initial.RootElement.GetProperty("files")
            .EnumerateArray().Where(item => item.GetProperty("action").GetString() ==
                "hash_required").Select(item => item.GetProperty("id").GetString()!)
            .ToHashSet(StringComparer.Ordinal);
        if (candidates.Count == 0) return [];

        using var hashSlots = new SemaphoreSlim(2);
        var verified = new ConcurrentBag<object>();
        await Task.WhenAll(sources.Where(file => candidates.Contains(file.FileId))
            .Select(async file =>
            {
                await hashSlots.WaitAsync(cancellationToken);
                try
                {
                    using FileStream stream = new(file.Path, FileMode.Open,
                        FileAccess.Read, FileShare.Read, 1024 * 1024,
                        FileOptions.Asynchronous | FileOptions.SequentialScan);
                    string hash = Convert.ToHexString(await SHA256.HashDataAsync(stream,
                        cancellationToken)).ToLowerInvariant();
                    verified.Add(new { id = file.FileId, name = file.Name,
                        size = file.SizeBytes, sha256 = hash });
                }
                finally { hashSlots.Release(); }
            }));
        using JsonDocument response = await NativeTransferProtocol.PostJsonAsync(client,
            "/upload/preflight/verify", new { files = verified.ToArray() }, approval,
            true, cancellationToken);
        var skipped = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonElement item in response.RootElement.GetProperty("files").EnumerateArray())
        {
            if (item.GetProperty("action").GetString() != "skip") continue;
            string id = item.GetProperty("id").GetString()!;
            TransferSource source = sources.First(file => file.FileId == id);
            results[id] = new(id, source.Name, TransferFileState.Skipped,
                item.TryGetProperty("filename", out JsonElement name) ? name.GetString() : null);
            skipped.Add(id);
            terminal();
        }
        return skipped;
    }
}
