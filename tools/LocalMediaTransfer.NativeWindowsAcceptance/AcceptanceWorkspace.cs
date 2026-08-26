using System.Security.Cryptography;

namespace LocalMediaTransfer.NativeWindowsAcceptance;

public sealed class AcceptanceWorkspace : IDisposable
{
    private readonly bool _keep;

    public AcceptanceWorkspace(bool keep)
    {
        _keep = keep;
        Root = Path.Combine(Path.GetTempPath(), "LocalMediaTransfer.Tests",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
        RunLabel = Guid.NewGuid().ToString("N")[..8];
    }

    public string Root { get; }
    public string RunLabel { get; }

    public IReadOnlyList<string> CreateBoundaryFiles()
    {
        string directory = Path.Combine(Root, "boundary");
        Directory.CreateDirectory(directory);
        var paths = new string[1000];
        for (int index = 0; index < paths.Length; index++)
        {
            string path = Path.Combine(directory,
                $"LMT-Acceptance-{RunLabel}-Boundary-{index + 1:D4}.bin");
            byte[] content = new byte[1024];
            BitConverter.TryWriteBytes(content.AsSpan(0, sizeof(int)), index);
            RandomNumberGenerator.Fill(content.AsSpan(sizeof(int)));
            File.WriteAllBytes(path, content);
            paths[index] = path;
        }
        return paths;
    }

    public string CreateLargeFile(string purpose, int sizeMiB)
    {
        string path = Path.Combine(Root,
            $"LMT-Acceptance-{RunLabel}-{purpose}.bin");
        long length = sizeMiB * 1024L * 1024L;
        byte[] marker = RandomNumberGenerator.GetBytes(4096);
        using FileStream stream = new(path, FileMode.CreateNew, FileAccess.Write,
            FileShare.None, 4096, FileOptions.SequentialScan);
        stream.SetLength(length);
        stream.Position = 0;
        stream.Write(marker);
        stream.Position = length - marker.Length;
        stream.Write(marker);
        stream.Flush(true);
        return path;
    }

    public string CreateRecoveryFile()
    {
        string path = Path.Combine(Root,
            $"LMT-Acceptance-{RunLabel}-Restart-Recovery.bin");
        File.WriteAllBytes(path, RandomNumberGenerator.GetBytes(64 * 1024));
        return path;
    }

    public void Dispose()
    {
        if (_keep)
        {
            Console.WriteLine($"Generated sender files retained at: {Root}");
            return;
        }
        string allowedRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(),
            "LocalMediaTransfer.Tests")) + Path.DirectorySeparatorChar;
        string resolved = Path.GetFullPath(Root);
        if (!resolved.StartsWith(allowedRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Refusing unsafe acceptance cleanup path.");
        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                if (Directory.Exists(resolved)) Directory.Delete(resolved, true);
                return;
            }
            catch (IOException) when (attempt < 4)
            {
                Thread.Sleep(100 * (attempt + 1));
            }
            catch (UnauthorizedAccessException) when (attempt < 4)
            {
                Thread.Sleep(100 * (attempt + 1));
            }
        }
    }
}
