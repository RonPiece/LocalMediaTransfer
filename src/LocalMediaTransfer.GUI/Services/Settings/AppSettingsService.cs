using System;

namespace LocalMediaTransfer.GUI.Services
{
    public static class AppSettingsService
    {
        public static string? UploadDirectory
        {
            get => AppSettingsStore.GetString(AppSettingKeys.UploadDir);
            set => AppSettingsStore.SetString(AppSettingKeys.UploadDir, value ?? "");
        }

        public static bool AllowInsecureHttp
        {
            get => AppSettingsStore.GetInt(AppSettingKeys.AllowInsecureHttp) == 1;
            set => AppSettingsStore.SetInt(AppSettingKeys.AllowInsecureHttp, value ? 1 : 0);
        }

        public static bool NearbyDesktopDiscovery
        {
            get => AppSettingsStore.GetInt(AppSettingKeys.NearbyDesktopDiscovery) == 1;
            set => AppSettingsStore.SetInt(AppSettingKeys.NearbyDesktopDiscovery, value ? 1 : 0);
        }

        public static bool MinimizeToTray
        {
            get
            {
                var setting = AppSettingsStore.GetInt(AppSettingKeys.MinimizeToTray);
                return !setting.HasValue || setting.Value != 0;
            }
            set => AppSettingsStore.SetInt(AppSettingKeys.MinimizeToTray, value ? 1 : 0);
        }

        public static bool TrayExplanationShown
        {
            get => AppSettingsStore.GetInt(AppSettingKeys.TrayExplanationShown) == 1;
            set => AppSettingsStore.SetInt(AppSettingKeys.TrayExplanationShown, value ? 1 : 0);
        }

        public static FilenameConflictPolicy FilenameConflictPolicy
        {
            get => string.Equals(
                AppSettingsStore.GetString(AppSettingKeys.FilenameConflictPolicy),
                "Reject",
                StringComparison.OrdinalIgnoreCase)
                    ? FilenameConflictPolicy.Reject
                    : FilenameConflictPolicy.KeepBoth;
            set => AppSettingsStore.SetString(
                AppSettingKeys.FilenameConflictPolicy,
                value == FilenameConflictPolicy.Reject ? "Reject" : "KeepBoth");
        }

        public static bool AutoApproveKnownDevices
        {
            get => AppSettingsStore.GetInt(AppSettingKeys.AutoApproveKnownDevices) == 1;
            set => AppSettingsStore.SetInt(AppSettingKeys.AutoApproveKnownDevices, value ? 1 : 0);
        }

        public static bool NearbySenderDiscoveryConsent
        {
            get => AppSettingsStore.GetInt(AppSettingKeys.NearbySenderDiscoveryConsent) == 1;
            set => AppSettingsStore.SetInt(AppSettingKeys.NearbySenderDiscoveryConsent,
                value ? 1 : 0);
        }
    }
}
