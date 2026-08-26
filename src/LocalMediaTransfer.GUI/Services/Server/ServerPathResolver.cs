using System;
using System.IO;

namespace LocalMediaTransfer.GUI.Services
{
    internal static class ServerPathResolver
    {
        public const string ServerExeName = "LocalMediaTransferServer.exe";

        public static string FindServerPath()
        {
            string[] installPaths =
            {
                Path.Combine(AppContext.BaseDirectory, "server", ServerExeName),
                Path.Combine(AppContext.BaseDirectory, ServerExeName)
            };

            foreach (var path in installPaths)
            {
                if (IsAcceptableExecutable(path))
                {
                    return Path.GetFullPath(path);
                }
            }

            var currentDir = new DirectoryInfo(AppContext.BaseDirectory);
            DirectoryInfo? repoRoot = null;

            while (currentDir != null)
            {
                if (Directory.Exists(Path.Combine(currentDir.FullName, "src", "Server")))
                {
                    repoRoot = currentDir;
                    break;
                }
                currentDir = currentDir.Parent;
            }

            if (repoRoot == null)
            {
                throw new FileNotFoundException(
                    $"Cannot find the installed {ServerExeName} beside the GUI executable.");
            }

            string[] searchPaths =
            {
                Path.Combine(repoRoot.FullName, "src", "Server", "out", "build", "x64-Debug", "bin", ServerExeName),
                Path.Combine(repoRoot.FullName, "src", "Server", "out", "build", "x64-Release", "bin", ServerExeName),
                Path.Combine(repoRoot.FullName, "src", "Server", "out", "build", "x64-debug", "bin", ServerExeName),
                Path.Combine(repoRoot.FullName, "src", "Server", "out", "build", "x64-release", "bin", ServerExeName),
                Path.Combine(repoRoot.FullName, "src", "Server", "build", "bin", ServerExeName),
                Path.Combine(repoRoot.FullName, "src", "Server", "build", "Release", ServerExeName),
                Path.Combine(repoRoot.FullName, "src", "Server", "build", "Debug", ServerExeName),
                installPaths[0],
                installPaths[1]
            };

            foreach (var path in searchPaths)
            {
                if (IsAcceptableExecutable(path))
                {
                    return Path.GetFullPath(path);
                }
            }

            throw new FileNotFoundException(
                $"Cannot find {ServerExeName}. First checked: {searchPaths[0]}");
        }

        private static bool IsAcceptableExecutable(string path)
        {
            try
            {
                string fullPath = Path.GetFullPath(path);
                if (!Path.IsPathFullyQualified(fullPath) ||
                    !string.Equals(
                        Path.GetFileName(fullPath),
                        ServerExeName,
                        StringComparison.OrdinalIgnoreCase) ||
                    !File.Exists(fullPath))
                {
                    return false;
                }

                FileAttributes attributes = File.GetAttributes(fullPath);
                return (attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0;
            }
            catch
            {
                return false;
            }
        }
    }
}
