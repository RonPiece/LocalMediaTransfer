using System;
using System.IO;

namespace LocalMediaTransfer.GUI.Services
{
    internal static class ServerLaunchOptionsBuilder
    {
        public static ServerLaunchOptions Build(
            Func<string> serverPathResolver,
            int httpsPort,
            string uploadDirectory,
            FilenameConflictPolicy filenameConflictPolicy,
            int httpPort,
            bool allowInsecureHttp,
            string tlsStorageDirectory,
            string environmentName,
            string defaultUploadDirectory,
            string? dataRootDirectory,
            ServerOwnershipContext ownershipContext)
        {
            if (string.IsNullOrWhiteSpace(uploadDirectory))
            {
                uploadDirectory = defaultUploadDirectory;
            }

            Directory.CreateDirectory(uploadDirectory);

            return new ServerLaunchOptions(
                serverPathResolver(),
                httpsPort,
                uploadDirectory,
                filenameConflictPolicy,
                httpPort,
                allowInsecureHttp,
                tlsStorageDirectory,
                environmentName,
                dataRootDirectory,
                ownershipContext.ControlTokenHex,
                ownershipContext.OwnerProcessId,
                ownershipContext.OwnerProcessStartTimeUtcFileTime,
                ownershipContext.ControlInstanceId);
        }
    }
}
