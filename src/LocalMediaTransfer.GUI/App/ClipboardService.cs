using Windows.ApplicationModel.DataTransfer;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class ClipboardService
    {
        public static void SetText(string? value)
        {
            var package = new DataPackage();
            package.SetText(value ?? string.Empty);
            Clipboard.SetContent(package);
        }

        public static void SetSensitiveText(string? value)
        {
            var package = new DataPackage();
            package.SetText(value ?? string.Empty);
            Clipboard.SetContentWithOptions(
                package,
                new ClipboardContentOptions
                {
                    IsAllowedInHistory = false,
                    IsRoamable = false
                });
        }
    }
}
