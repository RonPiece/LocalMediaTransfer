using System;
using LiveChartsCore;
using LiveChartsCore.Defaults;
using LiveChartsCore.SkiaSharpView;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Features.Dashboard;
using LocalMediaTransfer.GUI.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace LocalMediaTransfer.GUI.Features.Activity
{
    public sealed partial class ActivityPage : Page
    {
        private PipeClient? _pipeClient;
        private MainWindow? _mainWindow;
        private bool? _isWideTransferTable;

        public DashboardViewModel ViewModel { get; } = new();

        public ActivityPage()
        {
            InitializeComponent();
            DataContext = ViewModel;
            ISeries[] series =
            [
                new LineSeries<ObservableValue>
                {
                    Values = ViewModel.SpeedValues,
                    Fill = new LiveChartsCore.SkiaSharpView.Painting.SolidColorPaint(
                        new SkiaSharp.SKColor(0, 120, 212, 80)),
                    Stroke = new LiveChartsCore.SkiaSharpView.Painting.SolidColorPaint(
                        new SkiaSharp.SKColor(0, 120, 212)) { StrokeThickness = 2 },
                    GeometrySize = 0,
                    LineSmoothness = 0.5
                }
            ];
            SpeedChart.Series = series;
            RecentTransfersList.ItemsSource = ViewModel.RecentTransfers;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            if (e.Parameter is not MainWindow mainWindow)
            {
                return;
            }

            _mainWindow = mainWindow;
            _pipeClient = mainWindow.PipeClient;
            _pipeClient.MetricsReceived += OnMetricsReceived;
            _pipeClient.TransferHistoryReceived += OnTransferHistoryReceived;
            _pipeClient.RequestTransferHistory();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            base.OnNavigatedFrom(e);
            if (_pipeClient == null)
            {
                return;
            }

            _pipeClient.MetricsReceived -= OnMetricsReceived;
            _pipeClient.TransferHistoryReceived -= OnTransferHistoryReceived;
        }

        private void OnMetricsReceived(MetricsData metrics) =>
            DispatcherQueue.TryEnqueue(() => ViewModel.ApplyMetrics(metrics));

        private void OnTransferHistoryReceived(
            System.Collections.Generic.IReadOnlyList<TransferHistoryData> sessions) =>
            DispatcherQueue.TryEnqueue(() => ViewModel.ApplyTransferHistory(sessions));

        private async void ClearHistory_Click(object sender, RoutedEventArgs e)
        {
            if (_pipeClient == null || _mainWindow == null)
            {
                return;
            }

            if (!await DialogService.ConfirmAsync(
                    XamlRoot,
                    "Clear transfer history?",
                    "Saved transfer-session records will be removed. Received files will not be deleted.",
                    "Clear history",
                    "Cancel"))
            {
                return;
            }

            ClearHistoryButton.IsEnabled = false;
            try
            {
                PipeCommandAcknowledgement result =
                    await ViewModel.ClearTransferHistoryAsync(
                        _pipeClient,
                        message => _mainWindow.AddNetworkLog(message));
                if (!result.Success)
                {
                    await DialogService.ShowMessageAsync(
                        XamlRoot,
                        "History was not cleared",
                        result.Error);
                }
            }
            catch (Exception exception)
            {
                App.LogDiagnostic("Activity", "Clearing transfer history failed.", exception);
                await DialogService.ShowMessageAsync(
                    XamlRoot,
                    "History was not cleared",
                    "The receiver did not complete the request. Check that it is running and try again.");
            }
            finally
            {
                ClearHistoryButton.IsEnabled = true;
            }
        }

        private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            bool desktop = ResponsiveLayoutDecisions.UseDesktopPage(e.NewSize.Width);
            RootLayout.Padding = desktop
                ? new Thickness(20, 20, 20, 24)
                : new Thickness(16, 16, 16, 24);

            MetricsColumn1.Width = new GridLength(1, GridUnitType.Star);
            MetricsColumn2.Width = desktop
                ? new GridLength(1, GridUnitType.Star)
                : new GridLength(0);
            Place(SpeedCard, 0, 0);
            Place(FilesCard, desktop ? 0 : 1, desktop ? 1 : 0);
            Place(DurationCard, desktop ? 1 : 2, 0);
            Place(TotalCard, desktop ? 1 : 3, desktop ? 1 : 0);

            RecentTitleColumn2.Width = desktop ? GridLength.Auto : new GridLength(0);
            Grid.SetRow(ClearHistoryButton, desktop ? 0 : 1);
            Grid.SetColumn(ClearHistoryButton, desktop ? 1 : 0);
            ClearHistoryButton.HorizontalAlignment = desktop
                ? HorizontalAlignment.Right
                : HorizontalAlignment.Stretch;

            bool wideTable = ResponsiveLayoutDecisions.UseDesktopTransferTable(e.NewSize.Width);
            RecentTransfersHeader.Visibility = wideTable ? Visibility.Visible : Visibility.Collapsed;
            if (_isWideTransferTable != wideTable)
            {
                RecentTransfersList.ItemTemplate = (DataTemplate)Resources[
                    wideTable ? "WideTransferItemTemplate" : "NarrowTransferItemTemplate"];
                _isWideTransferTable = wideTable;
            }
        }

        private static void Place(FrameworkElement element, int row, int column)
        {
            Grid.SetRow(element, row);
            Grid.SetColumn(element, column);
        }
    }
}
