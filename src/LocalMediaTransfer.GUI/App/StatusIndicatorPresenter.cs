using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class StatusIndicatorPresenter
    {
        public static void Update(
            NavigationView navView,
            TextBlock statusText,
            StackPanel statusIndicatorPanel,
            FrameworkElement statusIndicatorContainer)
        {
            bool isPaneCollapsed = !navView.IsPaneOpen;

            statusText.Visibility = isPaneCollapsed ? Visibility.Collapsed : Visibility.Visible;
            statusIndicatorPanel.HorizontalAlignment = isPaneCollapsed
                ? HorizontalAlignment.Center
                : HorizontalAlignment.Left;
            statusIndicatorPanel.Margin = isPaneCollapsed
                ? new Thickness(0)
                : new Thickness(4, 0, 0, 0);
            statusIndicatorPanel.Spacing = isPaneCollapsed ? 0 : 8;
            statusIndicatorContainer.HorizontalAlignment = isPaneCollapsed
                ? HorizontalAlignment.Center
                : HorizontalAlignment.Stretch;
            statusIndicatorContainer.Width = isPaneCollapsed
                ? navView.CompactPaneLength
                : double.NaN;
        }
    }
}
