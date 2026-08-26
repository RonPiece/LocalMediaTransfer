using System.Security.Cryptography;
using System.Text;

namespace LocalMediaTransfer.Benchmarks;

internal static class DeterministicFileGenerator
{
    private const int FileStreamBufferSize = 1024 * 1024;
    private const int PatternBufferSize = 8 * 1024 * 1024;

    public static async Task<IReadOnlyList<GeneratedFile>> GenerateAsync(
        string directory,
        BenchmarkRunSpec run,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(directory);
        var generated = new List<GeneratedFile>(run.Files.Count);

        for (int index = 0; index < run.Files.Count; index++)
        {
            BenchmarkFileSpec spec = run.Files[index];
            string uniqueName = $"{run.Label}-{index:00}-{spec.Name}";
            string path = Path.Combine(directory, uniqueName);
            int seed = StableSeed($"{run.Profile}:{run.Label}:{spec.Name}:{spec.SizeBytes}");
            string hash = await GenerateOneAsync(path, spec.SizeBytes, seed, cancellationToken);
            generated.Add(new(path, uniqueName, spec.SizeBytes, hash));
        }

        return generated;
    }

    private static async Task<string> GenerateOneAsync(
        string path,
        long sizeBytes,
        int seed,
        CancellationToken cancellationToken)
    {
        int bufferSize = (int)Math.Min(PatternBufferSize, Math.Max(1, sizeBytes));
        byte[] buffer = new byte[bufferSize];
        var random = new Random(seed);
        random.NextBytes(buffer);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        await using var output = new FileStream(
            path,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            FileStreamBufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        long remaining = sizeBytes;
        while (remaining > 0)
        {
            int count = (int)Math.Min(buffer.Length, remaining);
            hash.AppendData(buffer, 0, count);
            await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
            remaining -= count;
        }

        await output.FlushAsync(cancellationToken);
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private static int StableSeed(string input)
    {
        byte[] digest = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return BitConverter.ToInt32(digest, 0);
    }
}
