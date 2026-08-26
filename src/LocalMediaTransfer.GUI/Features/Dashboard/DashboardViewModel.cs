using System;
using System.Collections.ObjectModel;
using System.Text.Json;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using LiveChartsCore.Defaults;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Models;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.Features.Dashboard
{
    public sealed class DashboardViewModel : ObservableObject
    {
        public ObservableCollection<ObservableValue> SpeedValues { get; } = new();
        public ObservableCollection<TransferHistoryItem> RecentTransfers { get; } = new();

        private string _connectionUrl = "No active browser link.";
        public string ConnectionUrl
        {
            get => _connectionUrl;
            set => SetProperty(ref _connectionUrl, value);
        }

        private string _sessionToken = "";
        public string SessionToken
        {
            get => _sessionToken;
            set => SetProperty(ref _sessionToken, value);
        }

        private string _qrPayload = "";
        public string QrPayload
        {
            get => _qrPayload;
            private set => SetProperty(ref _qrPayload, value);
        }

        private string _uploadFolder = "";
        public string UploadFolder
        {
            get => _uploadFolder;
            private set => SetProperty(ref _uploadFolder, value);
        }

        private bool _isConnectionModeVisible;
        private bool _allowInsecureHttp;
        private string _httpsBrowserUrl = "";
        private string _httpBrowserUrl = "";
        private DateTimeOffset _browserLinkExpiresAtUtc = DateTimeOffset.MinValue;
        public DateTimeOffset BrowserLinkExpiresAtUtc => _browserLinkExpiresAtUtc;
        public int BrowserLinkRemainingSeconds => BrowserTransferSession.RemainingSeconds(
            _browserLinkExpiresAtUtc, DateTimeOffset.UtcNow);
        public bool IsBrowserLinkFresh =>
            BrowserLinkRemainingSeconds > 0 &&
            !string.IsNullOrWhiteSpace(_httpsBrowserUrl);
        public bool IsConnectionModeVisible
        {
            get => _isConnectionModeVisible;
            private set => SetProperty(ref _isConnectionModeVisible, value);
        }

        private int _selectedConnectionModeIndex;
        public int SelectedConnectionModeIndex
        {
            get => _selectedConnectionModeIndex;
            set => SetProperty(ref _selectedConnectionModeIndex, value);
        }

        private string _currentSpeed = "0";
        public string CurrentSpeed
        {
            get => _currentSpeed;
            set => SetProperty(ref _currentSpeed, value);
        }

        private string _currentSpeedUnit = "MB/s";
        public string CurrentSpeedUnit
        {
            get => _currentSpeedUnit;
            set => SetProperty(ref _currentSpeedUnit, value);
        }

        private string _fileCount = "0";
        public string FileCount
        {
            get => _fileCount;
            set => SetProperty(ref _fileCount, value);
        }

        private string _totalSizeGb = "0";
        public string TotalSizeGb
        {
            get => _totalSizeGb;
            set => SetProperty(ref _totalSizeGb, value);
        }

        private string _sessionDuration = "00:00:00";
        public string SessionDuration
        {
            get => _sessionDuration;
            set => SetProperty(ref _sessionDuration, value);
        }

        public DashboardViewModel()
        {
            for (int i = 0; i < 30; i++)
            {
                SpeedValues.Add(new ObservableValue(0));
            }
        }

        public async Task RefreshIosPairingAsync(
            ServerManager serverManager,
            string currentToken,
            string machineName)
        {
            for (int attempt = 0; attempt < 50 &&
                 (string.IsNullOrWhiteSpace(serverManager.TlsFingerprint) ||
                  string.IsNullOrWhiteSpace(serverManager.ServerId)); attempt++)
            {
                await Task.Delay(100);
                try { serverManager.RefreshTlsMetadata(); } catch { }
            }

            string localIP = NetworkUtils.GetLocalIpv4OrLoopback();
            string httpsUrl = $"https://{localIP}:{serverManager.Port}";

            IsConnectionModeVisible = serverManager.AllowInsecureHttp;
            _allowInsecureHttp = serverManager.AllowInsecureHttp;
            if (!serverManager.AllowInsecureHttp)
            {
                SelectedConnectionModeIndex = 0;
            }

            SessionToken = currentToken;
            UploadFolder = serverManager.UploadDir;

            var payload = DashboardPresentation.BuildPairingPayload(
                serverManager.ServerId,
                machineName,
                httpsUrl,
                serverManager.TlsFingerprint,
                currentToken,
                serverManager.RuntimeEnvironment);

            QrPayload = JsonSerializer.Serialize(payload);
        }

        public async Task CreateBrowserLinkAsync(
            ServerManager serverManager,
            PipeClient pipeClient)
        {
            for (int attempt = 0; attempt < 50 && !pipeClient.IsConnected; attempt++)
            {
                await Task.Delay(100);
            }
            if (!pipeClient.IsConnected)
            {
                throw new InvalidOperationException(
                    "The authenticated receiver connection is not ready.");
            }

            string browserBootstrap = Convert.ToHexString(
                System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
                .ToLowerInvariant();
            DateTimeOffset requestedAtUtc = DateTimeOffset.UtcNow;
            PipeCommandAcknowledgement bootstrapResult =
                await pipeClient.SetBrowserBootstrapAcknowledgedAsync(browserBootstrap);
            if (!bootstrapResult.Success)
            {
                throw new InvalidOperationException(
                    "A one-time browser link could not be created: " +
                    bootstrapResult.Error);
            }

            string localIP = NetworkUtils.GetLocalIpv4OrLoopback();
            string fragment = "#bootstrap=" + Uri.EscapeDataString(browserBootstrap);
            _httpsBrowserUrl = $"https://{localIP}:{serverManager.Port}/{fragment}";
            _httpBrowserUrl =
                $"http://{localIP}:{serverManager.HttpPort}/{fragment}";
            _browserLinkExpiresAtUtc = requestedAtUtc.AddSeconds(
                BrowserTransferSession.LifetimeSeconds);
            ApplyBrowserConnectionMode();
        }

        public void ApplyBrowserConnectionMode()
        {
            if (!IsBrowserLinkFresh)
            {
                return;
            }

            ConnectionUrl = _allowInsecureHttp && SelectedConnectionModeIndex == 1
                ? _httpBrowserUrl
                : _httpsBrowserUrl;
        }

        public void ExpireBrowserLink(string message = "No active browser link.")
        {
            _httpsBrowserUrl = "";
            _httpBrowserUrl = "";
            _browserLinkExpiresAtUtc = DateTimeOffset.MinValue;
            ConnectionUrl = message;
        }

        public void SetConnectionError(string message)
        {
            QrPayload = "";
        }

        public void SetBrowserLinkError(string message)
        {
            ExpireBrowserLink($"Error: {message}");
        }

        public void CopyConnectionUrl() =>
            ClipboardService.SetSensitiveText(ConnectionUrl);

        public void CopySessionToken() =>
            ClipboardService.SetSensitiveText(SessionToken);

        public void OpenConnectionUrl() =>
            ShellLauncherService.TryOpenConnectionUri(
                ConnectionUrl,
                _allowInsecureHttp);

        public void OpenUploadFolder() => ShellLauncherService.TryOpenFolder(UploadFolder);

        public async Task RestartServerAsync(MainWindow mainWindow)
        {
            await mainWindow.RestartServerAsync("Server restarted.", suppressDisconnectLog: true);
            ExpireBrowserLink("The previous browser link was invalidated by the receiver restart.");
            await RefreshIosPairingAsync(
                mainWindow.ServerManager,
                mainWindow.CurrentToken,
                Environment.MachineName);
        }

        public async Task StopServerAsync(MainWindow mainWindow)
        {
            bool wasActive = mainWindow.ServerManager.State is
                ServerManagerState.Starting or ServerManagerState.Running;
            await mainWindow.ServerManager.StopAsync();
            mainWindow.AddNetworkLog(wasActive ? "Server stopped." : "Server was already stopped.");
        }

        public async Task<PipeCommandAcknowledgement> ClearTransferHistoryAsync(
            PipeClient pipeClient,
            Action<string> addNetworkLog)
        {
            PipeCommandAcknowledgement result =
                await pipeClient.ClearTransferHistoryAcknowledgedAsync();
            if (!result.Success)
            {
                return result;
            }
            RecentTransfers.Clear();
            addNetworkLog("Transfer history cleared.");
            return result;
        }

        public void ApplyTransferHistory(System.Collections.Generic.IReadOnlyList<TransferHistoryData> sessions)
        {
            RecentTransfers.Clear();
            foreach (var item in DashboardPresentation.ToTransferItems(sessions))
            {
                RecentTransfers.Add(item);
            }
        }

        public void ApplyMetrics(MetricsData metrics)
        {
            if (SpeedValues.Count > 0)
            {
                SpeedValues.RemoveAt(0);
            }

            SpeedValues.Add(new ObservableValue(metrics.SpeedAvailable ? metrics.SpeedMBps : 0));
            CurrentSpeed = metrics.SpeedAvailable ? metrics.SpeedMBps.ToString("F1") : "\u2014";
            CurrentSpeedUnit = metrics.SpeedAvailable ? "MB/s" : "Unavailable";
            FileCount = metrics.FilesTransferred.ToString();
            TotalSizeGb = (metrics.TotalBytes / (1024.0 * 1024.0 * 1024.0)).ToString("F2");
            SessionDuration = TimeSpan.FromSeconds(metrics.DurationSeconds).ToString(@"hh\:mm\:ss");
        }
    }
}
