using System;
using System.Diagnostics;
using H.NotifyIcon;
using H.NotifyIcon.Core;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class TrayService
    {
        public static bool IsMinimizeToTrayEnabled()
        {
            if (string.Equals(
                    Environment.GetEnvironmentVariable("LMT_FORCE_MINIMIZE_TO_TRAY"),
                    "1",
                    StringComparison.Ordinal))
            {
                return true;
            }

            if (Debugger.IsAttached ||
                !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("VisualStudioVersion")))
            {
                return false;
            }

            return AppSettingsService.MinimizeToTray;
        }

        public static void ShowExplanationOnce(TaskbarIcon trayIcon)
        {
            if (AppSettingsService.TrayExplanationShown)
            {
                return;
            }

            AppSettingsService.TrayExplanationShown = true;
            try
            {
                trayIcon.ShowNotification(
                    "Local Media Transfer is still running",
                    "Use the tray icon to reopen the app or choose Exit.",
                    NotificationIcon.Info);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Unable to show tray notification: {ex.Message}");
            }
        }
    }
}
