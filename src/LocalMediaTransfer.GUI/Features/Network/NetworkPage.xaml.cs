using System.Collections.ObjectModel;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LocalMediaTransfer.GUI.Features.Network
{
    /// <summary>
    /// Network page showing network details and connection log.
    /// </summary>
    public sealed partial class NetworkPage : Page
    {
        public ObservableCollection<LogEntry> LogEntries => (App.MainWindow as MainWindow)?.NetworkLogs ?? new();
        public NetworkViewModel ViewModel { get; } = new();

        public NetworkPage()
        {
            InitializeComponent();
            DataContext = ViewModel;
            ConnectionLog.ItemsSource = LogEntries;
            ViewModel.Refresh((App.MainWindow as MainWindow)?.ServerManager);
        }

        private void CopyNetworkUrl_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e) =>
            ViewModel.CopyNetworkUrl();

        private async void RestartServer_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            if (App.MainWindow is MainWindow mainWindow)
            {
                await ViewModel.RestartServerAsync(mainWindow);
            }
        }

        private async void StopServer_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            if (App.MainWindow is MainWindow mainWindow)
            {
                await ViewModel.StopServerAsync(mainWindow);
            }
        }

        private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            bool useDesktopLayout = ResponsiveLayoutDecisions.UseDesktopPage(e.NewSize.Width);
            RootLayout.Padding = new Thickness(useDesktopLayout ? 24 : 16);
            TopCardsColumn2.Width = useDesktopLayout
                ? new GridLength(1, GridUnitType.Star)
                : new GridLength(0);
            Grid.SetRow(AddressesCard, useDesktopLayout ? 0 : 1);
            Grid.SetColumn(AddressesCard, useDesktopLayout ? 1 : 0);
        }
    }
}
