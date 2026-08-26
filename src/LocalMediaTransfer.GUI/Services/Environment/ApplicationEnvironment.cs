using System;
using System.IO;

namespace LocalMediaTransfer.GUI.Services
{
    public sealed record ApplicationEnvironmentProfile(
        string Name,
        string DisplayName,
        string DataDirectoryName,
        string GuiMutexName,
        string PipeName,
        int HttpsPort,
        int HttpPort,
        bool IsTest)
    {
        public string DataRoot
        {
            get
            {
                string defaultRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    DataDirectoryName);
                if (!IsTest)
                {
                    return defaultRoot;
                }

                string? overrideRoot = Environment.GetEnvironmentVariable(
                    "LMT_TEST_DATA_ROOT");
                if (string.IsNullOrWhiteSpace(overrideRoot))
                {
                    return defaultRoot;
                }

                string allowedRoot = Path.GetFullPath(Path.Combine(
                    Path.GetTempPath(),
                    "LocalMediaTransfer.Tests"));
                string candidate = Path.GetFullPath(overrideRoot);
                string allowedPrefix = allowedRoot.TrimEnd(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (!candidate.StartsWith(allowedPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        "LMT_TEST_DATA_ROOT must be below the isolated test root.");
                }

                return candidate;
            }
        }

        public string SettingsPath => Path.Combine(DataRoot, "gui-settings.json");
        public string LogDirectory => Path.Combine(DataRoot, "logs");
        public string TlsStorageDirectory => Path.Combine(DataRoot, "security");

        public string DefaultUploadDirectory => IsTest
            ? Path.Combine(DataRoot, "uploads")
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
                "LocalMediaTransfer");
    }

    public static class ApplicationEnvironment
    {
        public static ApplicationEnvironmentProfile Production { get; } = new(
            "production",
            "Local Media Transfer",
            "LocalMediaTransfer",
            @"Local\LocalMediaTransfer.GUI",
            "LocalMediaTransferPipe",
            8443,
            8080,
            IsTest: false);

        public static ApplicationEnvironmentProfile Test { get; } = new(
            "test",
            "Local Media Transfer TEST",
            "LocalMediaTransfer.Test",
            @"Local\LocalMediaTransfer.GUI.Test",
            "LocalMediaTransferPipe.Test",
            18443,
            18080,
            IsTest: true);

        public static ApplicationEnvironmentProfile Current
        {
            get
            {
#if LMT_TEST_ENVIRONMENT
                return Test;
#else
                return Production;
#endif
            }
        }
    }
}
