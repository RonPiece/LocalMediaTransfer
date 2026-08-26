using System;
using System.Collections.ObjectModel;
using System.Threading.Tasks;
using System.Windows.Input;
using CommunityToolkit.Mvvm.Input;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Features.Dashboard;
using LocalMediaTransfer.GUI.Models;
using LocalMediaTransfer.GUI.Services;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LocalMediaTransfer.GUI
{
    /// <summary>
    /// Main window shell. App lifecycle and server orchestration live in AppShellController.
    /// </summary>
    public sealed partial class MainWindow : Window
    {
        private readonly AppWindow _appWindow;
        private readonly AppShellController _controller;
        private bool _isForceClosing;
        private bool _trayDisposed;
        private AppShellStatusKind _shellStatus = AppShellStatusKind.Stopped;
        public bool IsNativeTransferActive { get; set; }
        public event Action? NativeTransferCancellationRequested;
        public event Action<int>? PendingApprovalsChanged;
        public int PendingApprovalCount { get; private set; }

        public MainWindow()
        {
            ShowWindowCommand = new RelayCommand(ShowWindowFromTray);
            ExitApplicationCommand = new AsyncRelayCommand(ExitFromTrayAsync);
            InitializeComponent();
            Title = ApplicationEnvironment.Current.DisplayName;
            TrayIcon.ToolTipText = ApplicationEnvironment.Current.DisplayName;
            TestEnvironmentBanner.Visibility = ApplicationEnvironment.Current.IsTest
                ? Visibility.Visible
                : Visibility.Collapsed;

            var hWnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hWnd);
            _appWindow = AppWindow.GetFromWindowId(windowId);
            _appWindow.Title = ApplicationEnvironment.Current.DisplayName;
            WindowChromeService.ApplyStartupChrome(_appWindow);
            _appWindow.Closing += AppWindow_Closing;

            _controller = new AppShellController(
                DispatcherQueue,
                () => Content?.XamlRoot,
                SetShellStatus);
            _controller.PendingApprovalCountChanged += count =>
            {
                PendingApprovalCount = count;
                TrayIcon.ToolTipText = count > 0
                    ? $"{ApplicationEnvironment.Current.DisplayName} — {count} approval pending"
                    : ApplicationEnvironment.Current.DisplayName;
                PendingApprovalsChanged?.Invoke(count);
            };

            NavView.PaneOpened += OnNavPaneStateChanged;
            NavView.PaneClosed += OnNavPaneStateChanged;
            NavView.DisplayModeChanged += OnNavDisplayModeChanged;
            Closed += MainWindow_Closed;

            _controller.Start();
            UpdateStatusIndicatorPresentation();

            ContentFrame.Navigate(typeof(DashboardPage), this);
            NavView.SelectedItem = NavView.MenuItems[0];

            ScheduleLifecycleSmokeAction();
        }

        public ServerManager ServerManager => _controller.ServerManager;
        public PipeClient PipeClient => _controller.PipeClient;
        public string CurrentToken
        {
            get => _controller.CurrentToken;
            set => _controller.CurrentToken = value;
        }
        public ObservableCollection<LogEntry> NetworkLogs => _controller.NetworkLogs;
        public ICommand ShowWindowCommand { get; }
        public ICommand ExitApplicationCommand { get; }

        public void AddNetworkLog(string message, DateTimeOffset? timestamp = null)
        {
            _controller.AddNetworkLog(message, timestamp);
        }

        public Task RestartServerAsync(string logMessage, bool suppressDisconnectLog = false)
        {
            return _controller.RestartServerAsync(logMessage, suppressDisconnectLog);
        }

        private void SetShellStatus(AppShellStatusKind status)
        {
            _shellStatus = status;
            switch (status)
            {
                case AppShellStatusKind.Starting:
                    StatusDot.Fill = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["SystemFillColorCautionBrush"];
                    StatusText.Text = "Starting...";
                    break;
                case AppShellStatusKind.Connecting:
                    StatusDot.Fill = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["SystemFillColorCautionBrush"];
                    StatusText.Text = "Connecting...";
                    break;
                case AppShellStatusKind.Running:
                    StatusDot.Fill = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["SystemFillColorSuccessBrush"];
                    StatusText.Text = "Server Running";
                    break;
                case AppShellStatusKind.Conflict:
                    StatusDot.Fill = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["SystemFillColorCautionBrush"];
                    StatusText.Text = "Server Conflict";
                    break;
                case AppShellStatusKind.Error:
                    StatusDot.Fill = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["SystemFillColorCriticalBrush"];
                    StatusText.Text = "Server Error";
                    break;
                default:
                    StatusDot.Fill = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["SystemFillColorCriticalBrush"];
                    StatusText.Text = "Server Stopped";
                    break;
            }
        }

        private void RootGrid_ActualThemeChanged(FrameworkElement sender, object args)
        {
            SetShellStatus(_shellStatus);
        }

        private async void MainWindow_Closed(object sender, WindowEventArgs args)
        {
            await CleanupForExitAsync();
        }

        private void AppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs args)
        {
            if (_controller.IsClosing || _isForceClosing)
            {
                return;
            }

            if (IsNativeTransferActive)
            {
                args.Cancel = true;
                _ = ConfirmCancelAndExitAsync();
                return;
            }

            if (!TrayService.IsMinimizeToTrayEnabled()) return;

            args.Cancel = true;
            sender.Hide();
            _controller.AddNetworkLog("Window hidden to tray.");
            TrayService.ShowExplanationOnce(TrayIcon);
        }

        private async Task ExitFromTrayAsync()
        {
            if (_controller.IsClosing)
            {
                return;
            }

            if (IsNativeTransferActive && !await ConfirmCancelTransferAsync()) return;
            _isForceClosing = true;
            _controller.AddNetworkLog("Exiting from tray.");
            await CleanupForExitAsync();
            Close();
            Application.Current.Exit();
        }

        private async Task ConfirmCancelAndExitAsync()
        {
            if (!await ConfirmCancelTransferAsync()) return;
            _isForceClosing = true;
            await CleanupForExitAsync();
            Close();
            Application.Current.Exit();
        }

        private async Task<bool> ConfirmCancelTransferAsync()
        {
            _appWindow.Show();
            XamlRoot? root = Content?.XamlRoot;
            if (root == null) return false;
            bool confirmed = await DialogService.ConfirmAsync(
                root,
                "Cancel active transfer and exit?",
                "Files still transferring will be cancelled. Minimizing to the tray keeps transfers running.",
                "Cancel Transfer and Exit",
                "Keep Running");
            if (confirmed) NativeTransferCancellationRequested?.Invoke();
            return confirmed;
        }

        private async Task CleanupForExitAsync()
        {
            _appWindow.Closing -= AppWindow_Closing;
            await _controller.CleanupForExitAsync();
            DisposeTrayIconBestEffort();
        }

        private void DisposeTrayIconBestEffort()
        {
            if (_trayDisposed)
            {
                return;
            }

            _trayDisposed = true;
            try
            {
                TrayIcon.Dispose();
            }
            catch
            {
                // Best-effort tray cleanup during process exit.
            }
        }

        private void ScheduleLifecycleSmokeAction()
        {
            if (!AppLifecycleService.TryGetSmokeExitDelay(out var delayMs))
            {
                return;
            }

            _ = AppLifecycleService.RunDelayedAsync(delayMs, ExitFromTrayAsync);
        }

        private void ShowWindowFromTray()
        {
            if (!_controller.IsClosing)
            {
                _appWindow.Show();
            }
        }

        private void OnNavPaneStateChanged(NavigationView sender, object args)
        {
            UpdateStatusIndicatorPresentation();
        }

        private void OnNavDisplayModeChanged(NavigationView sender, NavigationViewDisplayModeChangedEventArgs args)
        {
            UpdateStatusIndicatorPresentation();
        }

        private void UpdateStatusIndicatorPresentation()
        {
            StatusIndicatorPresenter.Update(NavView, StatusText, StatusIndicatorPanel, StatusIndicatorContainer);
        }

        private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
        {
            if (args.SelectedItemContainer is NavigationViewItem item)
            {
                var tag = item.Tag?.ToString();
                var pageType = NavigationService.ResolvePage(tag);
                if (pageType != null)
                {
                    ContentFrame.Navigate(pageType, this);
                }
            }
        }
    }
}
