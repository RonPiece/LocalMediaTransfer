using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.Features.Settings
{
    /// <summary>
    /// Settings page for configuring the application.
    /// </summary>
    public sealed partial class SettingsPage : Page
    {
        private MainWindow? _mainWindow;
        private bool _isInitializing;
        public SettingsViewModel ViewModel { get; } = new();

        public SettingsPage()
        {
            InitializeComponent();
            DataContext = ViewModel;
            _isInitializing = true;
            LoadSettings();
            _isInitializing = false;
            ThemeSelector.SelectionChanged += ThemeSelector_SelectionChanged;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            
            if (e.Parameter is MainWindow mainWindow)
            {
                _mainWindow = mainWindow;

                _isInitializing = true;
                UploadPath.Text = mainWindow.ServerManager.UploadDir;
                InsecureHttpToggle.IsOn = mainWindow.ServerManager.AllowInsecureHttp;
                FilenameConflictSelector.SelectedIndex =
                    mainWindow.ServerManager.FilenameConflictPolicy ==
                    FilenameConflictPolicy.Reject
                        ? 1
                        : 0;
                _isInitializing = false;
            }
        }

        private void LoadSettings()
        {
            ViewModel.Load();
            UploadPath.Text = ViewModel.UploadDirectory;
            InsecureHttpToggle.IsOn = ViewModel.AllowInsecureHttp;
            CloseBehaviorSelector.SelectedIndex = ViewModel.MinimizeToTray ? 0 : 1;
            FilenameConflictSelector.SelectedIndex =
                ViewModel.FilenameConflictPolicy == FilenameConflictPolicy.Reject ? 1 : 0;
            NearbyDiscoveryToggle.IsOn = ViewModel.NearbyDesktopDiscovery;
            if (ApplicationEnvironment.Current.IsTest)
            {
                BrowseUploadButton.IsEnabled = false;
                UploadPathDescription.Text =
                    "The test build always saves below its isolated test data root.";
            }
        }

        private async void InsecureHttpToggle_Toggled(object sender, RoutedEventArgs e)
        {
            if (_isInitializing || _mainWindow == null) return;
            var decision = SettingsToggleDecisions.ForHttpFallback(InsecureHttpToggle.IsOn);
            if (decision.RequiresConfirmation)
            {
                if (!await DialogService.ConfirmAsync(
                        XamlRoot,
                        decision.ConfirmationTitle,
                        decision.ConfirmationMessage,
                        "Use HTTP",
                        "Keep disabled"))
                {
                    _isInitializing = true;
                    InsecureHttpToggle.IsOn = false;
                    _isInitializing = false;
                    return;
                }
            }
            bool requested = InsecureHttpToggle.IsOn;
            try
            {
                AppSettingsService.AllowInsecureHttp = requested;
            }
            catch
            {
                _isInitializing = true;
                InsecureHttpToggle.IsOn = !requested;
                _isInitializing = false;
                await DialogService.ShowMessageAsync(
                    XamlRoot,
                    "HTTP setting was not changed",
                    "The setting could not be saved locally.");
                return;
            }
            _mainWindow.ServerManager.AllowInsecureHttp = requested;
            await RestartServerAsync(decision.LogMessage(requested), true);
        }

        private async System.Threading.Tasks.Task RestartServerAsync(
            string? logMessage = null,
            bool suppressDisconnectLog = false)
        {
            if (_mainWindow?.ServerManager == null)
            {
                return;
            }

            await _mainWindow.RestartServerAsync(
                string.IsNullOrWhiteSpace(logMessage) ? "Server restarted." : logMessage,
                suppressDisconnectLog);
        }

        private void ThemeSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (App.MainWindow?.Content is FrameworkElement rootElement)
            {
                rootElement.RequestedTheme = ThemeSelector.SelectedIndex switch
                {
                    1 => ElementTheme.Light,
                    2 => ElementTheme.Dark,
                    _ => ElementTheme.Default
                };
            }
        }

        private async void FilenameConflictSelector_SelectionChanged(
            object sender,
            SelectionChangedEventArgs e)
        {
            if (_isInitializing || _mainWindow == null)
            {
                return;
            }

            var policy = FilenameConflictSelector.SelectedIndex == 1
                ? FilenameConflictPolicy.Reject
                : FilenameConflictPolicy.KeepBoth;
            if (_mainWindow.ServerManager.FilenameConflictPolicy == policy)
            {
                return;
            }

            _mainWindow.ServerManager.FilenameConflictPolicy = policy;
            AppSettingsService.FilenameConflictPolicy = policy;

            await RestartServerAsync(
                policy == FilenameConflictPolicy.Reject
                    ? "Filename conflicts will now reject the new file. Restarting server."
                    : "Filename conflicts will now keep both files. Restarting server.",
                suppressDisconnectLog: true);
        }

        private async void BrowseFolder_Click(object sender, RoutedEventArgs e)
        {
            if (ApplicationEnvironment.Current.IsTest)
            {
                return;
            }
            var folderPath = App.MainWindow == null
                ? null
                : await FolderPickerService.PickFolderPathAsync(App.MainWindow);
            if (!string.IsNullOrWhiteSpace(folderPath))
            {
                UploadPath.Text = folderPath;
                AppSettingsService.UploadDirectory = folderPath;

                if (_mainWindow?.ServerManager != null)
                {
                    _mainWindow.ServerManager.UploadDir = folderPath;
                }

                await RestartServerAsync("Save folder changed. Restarting server.", suppressDisconnectLog: true);
            }
        }

        private void CloseBehaviorSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_isInitializing || _mainWindow == null)
            {
                return;
            }

            bool isTray = CloseBehaviorSelector.SelectedIndex == 0;
            AppSettingsService.MinimizeToTray = isTray;

            _mainWindow.AddNetworkLog(
                isTray
                    ? "Close behavior set to minimize to tray."
                    : "Close behavior set to exit application.");
        }

        private async void NearbyDiscoveryToggle_Toggled(object sender, RoutedEventArgs e)
        {
            if (_isInitializing || _mainWindow == null)
            {
                return;
            }

            var decision = SettingsToggleDecisions.ForNearbyDiscovery(NearbyDiscoveryToggle.IsOn);
            if (decision.RequiresConfirmation)
            {
                if (!await DialogService.ConfirmAsync(
                        XamlRoot,
                        decision.ConfirmationTitle,
                        decision.ConfirmationMessage,
                        "Enable discovery",
                        "Keep disabled"))
                {
                    _isInitializing = true;
                    NearbyDiscoveryToggle.IsOn = false;
                    _isInitializing = false;
                    return;
                }
            }

            bool requested = NearbyDiscoveryToggle.IsOn;
            bool previous = AppSettingsService.NearbyDesktopDiscovery;
            try
            {
                AppSettingsService.NearbyDesktopDiscovery = requested;
            }
            catch
            {
                _isInitializing = true;
                NearbyDiscoveryToggle.IsOn = previous;
                _isInitializing = false;
                await DialogService.ShowMessageAsync(
                    XamlRoot,
                    "Discovery setting was not changed",
                    "The setting could not be saved locally.");
                return;
            }

            PipeCommandAcknowledgement result =
                await _mainWindow.PipeClient.SetDiscoveryEnabledAcknowledgedAsync(
                    requested);
            if (!result.Success)
            {
                try { AppSettingsService.NearbyDesktopDiscovery = previous; } catch { }
                _isInitializing = true;
                NearbyDiscoveryToggle.IsOn = previous;
                _isInitializing = false;
                await DialogService.ShowMessageAsync(
                    XamlRoot,
                    "Discovery setting was not changed",
                    result.Error);
                return;
            }

            _mainWindow.AddNetworkLog(decision.LogMessage(requested));
        }

        private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            bool useDesktopLayout = ResponsiveLayoutDecisions.UseDesktopPage(e.NewSize.Width);
            RootLayout.Padding = new Thickness(useDesktopLayout ? 24 : 16);
            SettingsCardsColumn2.Width = useDesktopLayout
                ? new GridLength(1, GridUnitType.Star)
                : new GridLength(0);

            Place(FilenameConflictCard, useDesktopLayout ? 1 : 2, useDesktopLayout ? 1 : 0);
            Place(AutoStartCard, useDesktopLayout ? 4 : 5, useDesktopLayout ? 1 : 0);
            Place(MinimizeCard, useDesktopLayout ? 5 : 6, 0);
            Place(PrivacySection, useDesktopLayout ? 6 : 7, 0);
            Place(DiscoveryCard, useDesktopLayout ? 7 : 8, 0);
            Place(HttpCard, useDesktopLayout ? 8 : 9, 0);
        }

        private static void Place(FrameworkElement element, int row, int column)
        {
            Grid.SetRow(element, row);
            Grid.SetColumn(element, column);
        }

    }
}
