using System;
using System.Diagnostics;
using System.IO;
using System.Net;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class ShellLauncherService
    {
        public static bool TryOpenConnectionUri(
            string value,
            bool allowInsecureHttp)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out Uri? uri) ||
                uri.UserInfo.Length != 0 ||
                uri.Port is <= 0 or > 65535 ||
                !IPAddress.TryParse(uri.Host, out _) ||
                (uri.Scheme != Uri.UriSchemeHttps &&
                 !(allowInsecureHttp && uri.Scheme == Uri.UriSchemeHttp)))
            {
                return false;
            }

            return TryShellOpen(uri.AbsoluteUri);
        }

        private static bool TryShellOpen(string value)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = value,
                    UseShellExecute = true
                });
                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to open '{value}': {ex.Message}");
                return false;
            }
        }

        public static bool TryOpenFolder(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return false;
            }

            try
            {
                string fullPath = Path.GetFullPath(path);
                if (!Path.IsPathFullyQualified(fullPath))
                {
                    return false;
                }
                Directory.CreateDirectory(fullPath);
                return TryShellOpen(fullPath);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to open folder '{path}': {ex.Message}");
                return false;
            }
        }
    }
}
