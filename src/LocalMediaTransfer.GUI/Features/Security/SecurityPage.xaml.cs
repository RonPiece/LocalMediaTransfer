using System;
using System.Collections.Specialized;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Models;
using LocalMediaTransfer.GUI.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace LocalMediaTransfer.GUI.Features.Security
{
    /// <summary>
    /// Security page for managing session tokens and viewing connection history.
    /// </summary>
    public sealed partial class SecurityPage : Page
    {
        private MainWindow? _mainWindow;
        private PipeClient? _pipeClient;
        private bool _isInitializing;
        private bool _securityActionPending;
        public SecurityViewModel ViewModel { get; } = new();

        public SecurityPage()
        {
            InitializeComponent();
            DataContext = ViewModel;
            ConnectionHistory.ItemsSource = ViewModel.History;
            TrustedDevicesList.ItemsSource = ViewModel.TrustedDevices;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            if (e.Parameter is MainWindow mainWindow)
            {
                _mainWindow = mainWindow;
                _pipeClient = mainWindow.PipeClient;
                ViewModel.ApplySecurityState(mainWindow);
                ViewModel.RebuildConnectionHistory(mainWindow.NetworkLogs);
                mainWindow.NetworkLogs.CollectionChanged += OnNetworkLogsChanged;
                _pipeClient.TrustedDevicesReceived += OnTrustedDevicesReceived;
                ViewModel.RefreshTrustedDevices(_pipeClient);
                _isInitializing = true;
                AutoApproveKnownToggle.IsOn = AppSettingsService.AutoApproveKnownDevices;
                _isInitializing = false;
            }
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            base.OnNavigatedFrom(e);

            if (_mainWindow != null)
            {
                _mainWindow.NetworkLogs.CollectionChanged -= OnNetworkLogsChanged;
                if (_pipeClient != null) _pipeClient.TrustedDevicesReceived -= OnTrustedDevicesReceived;
            }
        }

        private void OnTrustedDevicesReceived(System.Collections.Generic.IReadOnlyList<TrustedDeviceData> devices)
        {
            DispatcherQueue.TryEnqueue(() => ViewModel.ReplaceTrustedDevices(devices));
        }

        private void RefreshDevices_Click(object sender, RoutedEventArgs e) =>
            ViewModel.RefreshTrustedDevices(_pipeClient);

        private async void RevokeDevice_Click(object sender, RoutedEventArgs e)
        {
            if (_pipeClient == null || sender is not Button button ||
                button.Tag is not string deviceId || string.IsNullOrWhiteSpace(deviceId))
            {
                return;
            }

            if (!TryBeginSecurityAction()) return;
            try
            {
                string deviceName = (button.DataContext as TrustedDeviceData)?.DeviceName ?? "this device";
                if (!await DialogService.ConfirmAsync(
                    XamlRoot,
                    "Revoke trusted device?",
                    $"{deviceName} will need to be approved again before it can transfer files.",
                    "Revoke",
                    "Cancel"))
                {
                    return;
                }

                PipeCommandAcknowledgement result =
                    await ViewModel.RevokeTrustedDeviceAsync(_pipeClient, deviceId);
                if (!result.Success)
                {
                    await DialogService.ShowMessageAsync(
                        XamlRoot,
                        "Device was not revoked",
                        result.Error);
                    return;
                }
                ViewModel.RefreshTrustedDevices(_pipeClient);
            }
            finally
            {
                EndSecurityAction();
            }
        }

        private async void AutoApproveKnown_Toggled(object sender, RoutedEventArgs e)
        {
            if (_pipeClient == null || _isInitializing) return;
            if (!TryBeginSecurityAction()) return;
            bool requested = AutoApproveKnownToggle.IsOn;
            try
            {
                PipeCommandAcknowledgement result =
                    await ViewModel.SetAutoApproveKnownAsync(_pipeClient, requested);
                if (result.Success) return;

                _isInitializing = true;
                AutoApproveKnownToggle.IsOn = !requested;
                _isInitializing = false;
                await DialogService.ShowMessageAsync(
                    XamlRoot,
                    "Security setting was not changed",
                    result.Error);
            }
            finally
            {
                EndSecurityAction();
            }
        }

        private async void RegenerateToken_Click(object sender, RoutedEventArgs e)
        {
            if (_mainWindow == null) return;
            if (!TryBeginSecurityAction()) return;
            try
            {
                if (!await DialogService.ConfirmAsync(
                    XamlRoot,
                    "Regenerate session token?",
                    "QR codes and manual connections using the current token will stop working. Already trusted devices remain authorized.",
                    "Regenerate",
                    "Cancel"))
                {
                    return;
                }

                PipeCommandAcknowledgement result =
                    await ViewModel.RegenerateTokenAsync(_mainWindow, _pipeClient);
                if (!result.Success)
                {
                    await DialogService.ShowMessageAsync(
                        XamlRoot,
                        "Session token was not changed",
                        result.Error);
                    return;
                }
                TokenInfoBar.IsOpen = true;

                var timer = DispatcherQueue.CreateTimer();
                timer.Interval = TimeSpan.FromSeconds(3);
                timer.IsRepeating = false;
                timer.Tick += (_, _) => TokenInfoBar.IsOpen = false;
                timer.Start();
            }
            finally
            {
                EndSecurityAction();
            }
        }

        private void CopyFingerprint_Click(object sender, RoutedEventArgs e) =>
            ViewModel.CopyFingerprint();

        private async void ResetTlsIdentity_Click(object sender, RoutedEventArgs e)
        {
            if (_mainWindow == null || _pipeClient == null) return;
            if (!TryBeginSecurityAction()) return;
            try
            {
                await ViewModel.ResetTlsIdentityAsync(XamlRoot, _mainWindow, _pipeClient);
            }
            finally
            {
                EndSecurityAction();
            }
        }

        private bool TryBeginSecurityAction()
        {
            if (_securityActionPending) return false;
            _securityActionPending = true;
            RegenerateTokenButton.IsEnabled = false;
            ResetIdentityButton.IsEnabled = false;
            TrustedDevicesList.IsEnabled = false;
            AutoApproveKnownToggle.IsEnabled = false;
            return true;
        }

        private void EndSecurityAction()
        {
            _securityActionPending = false;
            RegenerateTokenButton.IsEnabled = true;
            ResetIdentityButton.IsEnabled = true;
            TrustedDevicesList.IsEnabled = true;
            AutoApproveKnownToggle.IsEnabled = true;
        }

        private void OnNetworkLogsChanged(object? sender, NotifyCollectionChangedEventArgs e)
        {
            if (e.Action == NotifyCollectionChangedAction.Reset)
            {
                if (_mainWindow != null)
                {
                    ViewModel.RebuildConnectionHistory(_mainWindow.NetworkLogs);
                }
                return;
            }

            ViewModel.ApplyNetworkLogChange(e);
        }

        private void RootLayout_ActualThemeChanged(FrameworkElement sender, object args)
        {
            if (_mainWindow != null)
            {
                ViewModel.RebuildConnectionHistory(_mainWindow.NetworkLogs);
            }
        }

        private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            bool useDesktopLayout = ResponsiveLayoutDecisions.UseDesktopPage(e.NewSize.Width);
            RootLayout.Padding = new Thickness(useDesktopLayout ? 24 : 16);
            SecurityCardsColumn2.Width = useDesktopLayout
                ? new GridLength(1.2, GridUnitType.Star)
                : new GridLength(0);
            Grid.SetRow(HistoryCard, useDesktopLayout ? 0 : 1);
            Grid.SetColumn(HistoryCard, useDesktopLayout ? 1 : 0);
            IdentityActionsPanel.Orientation = useDesktopLayout
                ? Orientation.Horizontal
                : Orientation.Vertical;
        }
    }
}
