using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Navigation;
using LocalMediaTransfer.GUI.Services;
using LocalMediaTransfer.GUI.AppServices;

namespace LocalMediaTransfer.GUI.Features.Dashboard
{
    /// <summary>
    /// Dashboard page showing transfer stats, QR code for connection, and speed graph.
    /// </summary>
    public sealed partial class DashboardPage : Page
    {
        private PipeClient? _pipeClient;
        private bool _isUpdatingConnectionMode;
        private bool _isDashboardInitialized;
        private MainWindow? _mainWindow;
        private Microsoft.UI.Dispatching.DispatcherQueueTimer? _pairingTimer;
        private Microsoft.UI.Dispatching.DispatcherQueueTimer? _browserLinkTimer;
        private int _pairingSecondsRemaining;

        public DashboardViewModel ViewModel { get; } = new();

        public DashboardPage()
        {
            InitializeComponent();
            NavigationCacheMode = NavigationCacheMode.Required;
            DataContext = ViewModel;
            _isDashboardInitialized = true;
            ConnectionModeSelector.SelectionChanged += ConnectionModeSelector_SelectionChanged;
            
            NearbyReceiverToggle.IsOn = AppSettingsService.NearbyDesktopDiscovery;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            if (e.Parameter is MainWindow mainWindow)
            {
                _mainWindow = mainWindow;
                _pipeClient = mainWindow.PipeClient;
                _pipeClient.ConnectionChanged += OnPipeConnectionChanged;
                mainWindow.PendingApprovalsChanged += OnPendingApprovalsChanged;
                OnPendingApprovalsChanged(mainWindow.PendingApprovalCount);
                
                // The iPhone QR is always available. Browser credentials are
                // created only by the user's explicit flyout action.
                _ = RefreshIosPairingAsync(mainWindow);
                if (ViewModel.IsBrowserLinkFresh)
                {
                    StartBrowserLinkCountdown();
                }
            }
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            base.OnNavigatedFrom(e);

            if (_pipeClient != null)
            {
                _pipeClient.ConnectionChanged -= OnPipeConnectionChanged;
            }
            if (_mainWindow != null)
                _mainWindow.PendingApprovalsChanged -= OnPendingApprovalsChanged;
            _browserLinkTimer?.Stop();
        }

        private async Task RefreshIosPairingAsync(MainWindow mainWindow)
        {
            try
            {
                if (!_isDashboardInitialized)
                {
                    return;
                }

                await ViewModel.RefreshIosPairingAsync(
                    mainWindow.ServerManager,
                    mainWindow.CurrentToken,
                    Environment.MachineName);

                if (ConnectionModePanel == null ||
                    ConnectionModeSelector == null ||
                    ConnectionUrl == null ||
                    QrCodeImage == null)
                {
                    return;
                }

                _isUpdatingConnectionMode = true;
                ConnectionModePanel.Visibility = ViewModel.IsConnectionModeVisible
                    ? Microsoft.UI.Xaml.Visibility.Visible
                    : Microsoft.UI.Xaml.Visibility.Collapsed;
                ConnectionModeSelector.SelectedIndex = ViewModel.SelectedConnectionModeIndex;
                _isUpdatingConnectionMode = false;

                if (!string.IsNullOrWhiteSpace(ViewModel.QrPayload))
                {
                    QrCodeImage.Source = await QrCodeService.CreateBitmapAsync(ViewModel.QrPayload);
                }
            }
            catch (Exception ex)
            {
                ViewModel.SetConnectionError(ex.Message);
                if (ConnectionUrl != null)
                {
                    ConnectionUrl.Text = ViewModel.ConnectionUrl;
                }
            }
        }

        private async void RestartServer_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            if (App.MainWindow is MainWindow mainWindow && mainWindow.ServerManager != null)
            {
                await ViewModel.RestartServerAsync(mainWindow);
                await RefreshQrImageAsync();
                _browserLinkTimer?.Stop();
                await UpdateBrowserLinkPresentationAsync(refreshQr: false);
            }
        }

        private async void StopServer_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            if (App.MainWindow is MainWindow mainWindow && mainWindow.ServerManager != null)
            {
                await ViewModel.StopServerAsync(mainWindow);
                ViewModel.ExpireBrowserLink(
                    "The receiver is stopped. Start it before creating a browser link.");
                _browserLinkTimer?.Stop();
                await UpdateBrowserLinkPresentationAsync(refreshQr: false);
            }
        }

        private void CopyUrl_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            if (ViewModel.IsBrowserLinkFresh)
            {
                ViewModel.CopyConnectionUrl();
            }
        }

        private async void ConnectionModeHelp_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            await DialogService.ShowMessageAsync(
                XamlRoot,
                "Which connection type should I use?",
                "Use encrypted HTTPS whenever the browser can accept this receiver's local certificate. Use unencrypted HTTP only for a local browser that cannot continue over the self-signed HTTPS connection. HTTP must be enabled in Settings and exposes the transfer to the local network.");
        }

        private async void ConnectionModeSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_isUpdatingConnectionMode)
            {
                return;
            }

            ViewModel.SelectedConnectionModeIndex = ConnectionModeSelector.SelectedIndex;
            if (ViewModel.IsBrowserLinkFresh)
            {
                ViewModel.ApplyBrowserConnectionMode();
                await UpdateBrowserLinkPresentationAsync(refreshQr: true);
            }
        }

        private async Task RefreshQrImageAsync()
        {
            if (QrCodeImage != null && !string.IsNullOrWhiteSpace(ViewModel.QrPayload))
            {
                QrCodeImage.Source = await QrCodeService.CreateBitmapAsync(ViewModel.QrPayload);
            }
        }

        private void CopyToken_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            ViewModel.CopySessionToken();
        }

        private void OpenBrowser_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            if (ViewModel.IsBrowserLinkFresh)
            {
                ViewModel.OpenConnectionUrl();
            }
        }

        private async void RefreshBrowserLink_Click(object sender, RoutedEventArgs e)
        {
            if (App.MainWindow is not MainWindow mainWindow)
            {
                return;
            }

            RefreshBrowserLinkButton.IsEnabled = false;
            try
            {
                await ViewModel.CreateBrowserLinkAsync(
                    mainWindow.ServerManager,
                    mainWindow.PipeClient);
                await UpdateBrowserLinkPresentationAsync(refreshQr: true);
                StartBrowserLinkCountdown();
            }
            catch (Exception exception)
            {
                ViewModel.SetBrowserLinkError(exception.Message);
                await UpdateBrowserLinkPresentationAsync(refreshQr: false);
            }
            finally
            {
                RefreshBrowserLinkButton.IsEnabled = true;
            }
        }

        private async void BrowserTransferFlyout_Opened(object sender, object e)
        {
            await UpdateBrowserLinkPresentationAsync(refreshQr: ViewModel.IsBrowserLinkFresh);
        }

        private void StartBrowserLinkCountdown()
        {
            _browserLinkTimer?.Stop();
            _browserLinkTimer = DispatcherQueue.CreateTimer();
            _browserLinkTimer.Interval = TimeSpan.FromSeconds(1);
            _browserLinkTimer.Tick += async (_, _) =>
                await UpdateBrowserLinkPresentationAsync(refreshQr: false);
            _browserLinkTimer.Start();
        }

        private async Task UpdateBrowserLinkPresentationAsync(bool refreshQr)
        {
            bool active = ViewModel.IsBrowserLinkFresh;
            if (!active && ViewModel.BrowserLinkExpiresAtUtc != DateTimeOffset.MinValue &&
                ViewModel.BrowserLinkRemainingSeconds == 0)
            {
                ViewModel.ExpireBrowserLink(
                    "This browser link expired. Create a new link when the other device is ready.");
                _browserLinkTimer?.Stop();
            }

            active = ViewModel.IsBrowserLinkFresh;
            ConnectionUrl.Text = ViewModel.ConnectionUrl;
            CopyUrlBtn.IsEnabled = active;
            OpenBrowserBtn.IsEnabled = active;
            BrowserQrPanel.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
            RefreshBrowserLinkButton.Content = active
                ? "Replace browser link"
                : "Create browser link";
            BrowserLinkStatusText.Text = active
                ? $"Available for up to {BrowserTransferSession.FormatRemaining(ViewModel.BrowserLinkRemainingSeconds)} · first successful use consumes it"
                : ViewModel.ConnectionUrl.StartsWith("Error:", StringComparison.Ordinal)
                    ? "Link creation failed · check the receiver and try again"
                    : "No active link · create one when you are ready to share";

            if (active && refreshQr)
            {
                try
                {
                    BrowserQrCodeImage.Source = await QrCodeService.CreateBitmapAsync(
                        ViewModel.ConnectionUrl);
                }
                catch (Exception)
                {
                    App.LogDiagnostic(
                        "BrowserTransfer",
                        "The browser QR could not be rendered.");
                    BrowserQrPanel.Visibility = Visibility.Collapsed;
                    BrowserLinkStatusText.Text +=
                        " · QR unavailable; copy the link instead";
                }
            }
            else if (!active)
            {
                BrowserQrCodeImage.Source = null;
            }
        }

        private void OpenUploadFolder_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            ViewModel.OpenUploadFolder();
        }

        private async void PairWindows_Click(object sender, RoutedEventArgs e)
        {
            if (_pipeClient == null || !_pipeClient.IsConnected)
            {
                await DialogService.ShowMessageAsync(XamlRoot,
                    "Receiver is not ready",
                    "Wait until the local server is running, then try again.");
                return;
            }
            PairWindowsButton.IsEnabled = false;
            PipeCommandAcknowledgement result =
                await _pipeClient.BeginNativePairingAcknowledgedAsync();
            PairWindowsButton.IsEnabled = true;
            NativeReceiverStatus.Text = result.Success
                ? "Pairing is open for two minutes. On the sending computer, open Send and scan or enter this computer's private IPv4 address."
                : "Pairing could not be opened: " + result.Error;
            if (result.Success) StartPairingCountdown();
        }

        private void StartPairingCountdown()
        {
            _pairingTimer?.Stop();
            _pairingSecondsRemaining = 120;
            _pairingTimer = DispatcherQueue.CreateTimer();
            _pairingTimer.Interval = TimeSpan.FromSeconds(1);
            _pairingTimer.Tick += async (_, _) =>
            {
                _pairingSecondsRemaining--;
                if (_pairingSecondsRemaining > 0)
                {
                    NativeReceiverStatus.Text =
                        $"Windows pairing open · {_pairingSecondsRemaining / 60}:{_pairingSecondsRemaining % 60:D2} remaining";
                    return;
                }
                _pairingTimer?.Stop();
                if (_pipeClient?.IsConnected == true)
                    await _pipeClient.EndNativePairingAcknowledgedAsync();
                NativeReceiverStatus.Text =
                    "Ready. Windows pairing is closed; every incoming transfer requires approval.";
            };
            _pairingTimer.Start();
        }

        private void OnPendingApprovalsChanged(int count) => DispatcherQueue.TryEnqueue(() =>
            PendingApprovalsText.Text = count == 0 ? "No approvals pending" :
                $"{count} approval{(count == 1 ? "" : "s")} pending");

        private void OnPipeConnectionChanged(bool connected) => DispatcherQueue.TryEnqueue(() =>
            NativeReceiverStatus.Text = connected
                ? "Ready. Windows pairing is closed; every incoming transfer requires approval."
                : "Not ready. Waiting for the authenticated local receiver service.");

        private async void NearbyReceiverToggle_Toggled(object sender, RoutedEventArgs e)
        {
            if (!_isDashboardInitialized) return;
            bool enabled = NearbyReceiverToggle.IsOn;
            AppSettingsService.NearbyDesktopDiscovery = enabled;
            if (_pipeClient?.IsConnected == true)
            {
                PipeCommandAcknowledgement result =
                    await _pipeClient.SetDiscoveryEnabledAcknowledgedAsync(enabled);
                if (!result.Success)
                {
                    NearbyReceiverToggle.IsOn = !enabled;
                    AppSettingsService.NearbyDesktopDiscovery = !enabled;
                    NativeReceiverStatus.Text = "Discovery setting was not applied: " + result.Error;
                }
            }
        }

        private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            bool useDesktopLayout = ResponsiveLayoutDecisions.UseDesktopPage(e.NewSize.Width);
            RootLayout.Padding = useDesktopLayout
                ? new Thickness(20, 20, 20, 24)
                : new Thickness(16, 16, 16, 24);
            NativeReceiverActions.Orientation = e.NewSize.Width < 640
                ? Orientation.Vertical
                : Orientation.Horizontal;

            ConnectionMethodsColumn1.Width = new GridLength(1, GridUnitType.Star);
            ConnectionMethodsColumn2.Width = useDesktopLayout
                ? new GridLength(0.8, GridUnitType.Star)
                : new GridLength(0);
            Place(QrCard, 0, 0);
            Place(SecondaryMethodsPanel, useDesktopLayout ? 0 : 1, useDesktopLayout ? 1 : 0);
        }

        private static void Place(FrameworkElement element, int row, int column, int rowSpan = 1)
        {
            Grid.SetRow(element, row);
            Grid.SetColumn(element, column);
            Grid.SetRowSpan(element, rowSpan);
        }
    }
}
