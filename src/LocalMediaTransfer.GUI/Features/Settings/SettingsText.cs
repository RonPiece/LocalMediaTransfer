namespace LocalMediaTransfer.GUI.Features.Settings
{
    public static class SettingsText
    {
        public const string HttpFallbackTitle = "Use unencrypted HTTP?";
        public const string HttpFallbackWarning =
            "Only use HTTP for Expo Go or older clients that cannot use pinned HTTPS. Files and access tokens are not encrypted on HTTP, so keep HTTPS as the normal connection method.";

        public const string NearbyDiscoveryTitle = "Enable nearby desktop discovery?";
        public const string NearbyDiscoveryWarning =
            "This lets the installed iOS app find this desktop on the same Wi-Fi network. Turn it on here and on the iPhone. Discovery uses credential-free UDP on port 45892; first connection still requires scanning the Windows QR and approving the iPhone.";
    }
}
