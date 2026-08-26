using System;
using CommunityToolkit.Mvvm.ComponentModel;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.Features.Settings
{
    public sealed class SettingsViewModel : ObservableObject
    {
        private string _uploadDirectory = DefaultUploadDirectory;
        public string UploadDirectory
        {
            get => _uploadDirectory;
            set => SetProperty(ref _uploadDirectory, value);
        }

        private bool _allowInsecureHttp;
        public bool AllowInsecureHttp
        {
            get => _allowInsecureHttp;
            set => SetProperty(ref _allowInsecureHttp, value);
        }

        private bool _minimizeToTray = true;
        public bool MinimizeToTray
        {
            get => _minimizeToTray;
            set => SetProperty(ref _minimizeToTray, value);
        }

        private FilenameConflictPolicy _filenameConflictPolicy = FilenameConflictPolicy.KeepBoth;
        public FilenameConflictPolicy FilenameConflictPolicy
        {
            get => _filenameConflictPolicy;
            set => SetProperty(ref _filenameConflictPolicy, value);
        }

        private bool _nearbyDesktopDiscovery;
        public bool NearbyDesktopDiscovery
        {
            get => _nearbyDesktopDiscovery;
            set => SetProperty(ref _nearbyDesktopDiscovery, value);
        }

        public static string DefaultUploadDirectory =>
            ApplicationEnvironment.Current.DefaultUploadDirectory;

        public void Load()
        {
            UploadDirectory = ApplicationEnvironment.Current.IsTest ||
                string.IsNullOrWhiteSpace(AppSettingsService.UploadDirectory)
                ? DefaultUploadDirectory
                : AppSettingsService.UploadDirectory!;
            AllowInsecureHttp = AppSettingsService.AllowInsecureHttp;
            MinimizeToTray = AppSettingsService.MinimizeToTray;
            FilenameConflictPolicy = AppSettingsService.FilenameConflictPolicy;
            NearbyDesktopDiscovery = AppSettingsService.NearbyDesktopDiscovery;
        }
    }
}
