using System;
using System.Diagnostics;
using System.IO;
using Microsoft.UI.Windowing;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class WindowChromeService
    {
        private const int InitialWindowWidth = 1280;
        private const int InitialWindowHeight = 820;
        private const int MinimumWindowWidth = 980;
        private const int MinimumWindowHeight = 700;

        public static void ApplyStartupChrome(AppWindow appWindow)
        {
            TrySetWindowIcon(appWindow);
            ApplyWindowSizingConstraints(appWindow);
        }

        private static void ApplyWindowSizingConstraints(AppWindow appWindow)
        {
            if (appWindow.Presenter is OverlappedPresenter presenter)
            {
                presenter.PreferredMinimumWidth = MinimumWindowWidth;
                presenter.PreferredMinimumHeight = MinimumWindowHeight;
            }

            appWindow.Resize(new Windows.Graphics.SizeInt32(
                Math.Max(InitialWindowWidth, MinimumWindowWidth),
                Math.Max(InitialWindowHeight, MinimumWindowHeight)));
        }

        private static void TrySetWindowIcon(AppWindow appWindow)
        {
            try
            {
                var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "Icons", "AppIcon.ico");
                if (File.Exists(iconPath))
                {
                    appWindow.SetIcon(iconPath);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Unable to set window icon: {ex.Message}");
            }
        }
    }
}
