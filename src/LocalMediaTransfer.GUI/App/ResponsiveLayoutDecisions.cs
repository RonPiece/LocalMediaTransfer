namespace LocalMediaTransfer.GUI.AppServices
{
    public static class ResponsiveLayoutDecisions
    {
        public const double DesktopPageWidth = 860;
        public const double DesktopTransferTableWidth = 1040;

        public static bool UseDesktopPage(double availableWidth) =>
            double.IsFinite(availableWidth) && availableWidth >= DesktopPageWidth;

        public static bool UseDesktopTransferTable(double availableWidth) =>
            double.IsFinite(availableWidth) && availableWidth >= DesktopTransferTableWidth;
    }
}
