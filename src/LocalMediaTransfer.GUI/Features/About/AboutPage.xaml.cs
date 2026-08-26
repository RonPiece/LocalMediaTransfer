using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.Features.About
{
    /// <summary>
    /// About page showing app information and links.
    /// </summary>
    public sealed partial class AboutPage : Page
    {
        public AboutPage()
        {
            InitializeComponent();
            AppNameText.Text = ApplicationEnvironment.Current.DisplayName;
            var version = typeof(AboutPage).Assembly.GetName().Version;
            VersionText.Text = version is null
                ? "Version unavailable"
                : $"Desktop and server version {version.Major}.{version.Minor}.{version.Build}";
        }

        private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            bool useDesktopLayout = ResponsiveLayoutDecisions.UseDesktopPage(e.NewSize.Width);
            RootLayout.Padding = new Thickness(useDesktopLayout ? 24 : 16);
            AboutCardsColumn2.Width = useDesktopLayout
                ? new GridLength(1, GridUnitType.Star)
                : new GridLength(0);

            Grid.SetRow(ProjectResourcesCard, useDesktopLayout ? 0 : 1);
            Grid.SetColumn(ProjectResourcesCard, useDesktopLayout ? 1 : 0);
            Grid.SetRow(OpenSourceCard, useDesktopLayout ? 1 : 2);
            Grid.SetColumnSpan(OpenSourceCard, useDesktopLayout ? 2 : 1);

            Place(PrivacyLink, useDesktopLayout ? 0 : 1, useDesktopLayout ? 1 : 0);
            Place(SecurityLink, useDesktopLayout ? 1 : 2, 0);
            Place(NoticesLink, useDesktopLayout ? 1 : 3, useDesktopLayout ? 1 : 0);
        }

        private static void Place(FrameworkElement element, int row, int column)
        {
            Grid.SetRow(element, row);
            Grid.SetColumn(element, column);
        }
    }
}
