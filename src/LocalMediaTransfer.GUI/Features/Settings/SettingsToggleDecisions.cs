namespace LocalMediaTransfer.GUI.Features.Settings
{
    public readonly record struct SettingsToggleDecision(
        bool RequiresConfirmation,
        string ConfirmationTitle,
        string ConfirmationMessage,
        string EnabledLogMessage,
        string DisabledLogMessage)
    {
        public string LogMessage(bool enabled) => enabled ? EnabledLogMessage : DisabledLogMessage;
    }

    public static class SettingsToggleDecisions
    {
        public static SettingsToggleDecision ForHttpFallback(bool enabled) =>
            new(
                enabled,
                SettingsText.HttpFallbackTitle,
                SettingsText.HttpFallbackWarning,
                "Unencrypted HTTP enabled. Restarting server.",
                "Unencrypted HTTP disabled. Restarting server.");

        public static SettingsToggleDecision ForNearbyDiscovery(bool enabled) =>
            new(
                enabled,
                SettingsText.NearbyDiscoveryTitle,
                SettingsText.NearbyDiscoveryWarning,
                "Nearby desktop discovery enabled on UDP port 45892.",
                "Nearby desktop discovery disabled.");
    }
}
