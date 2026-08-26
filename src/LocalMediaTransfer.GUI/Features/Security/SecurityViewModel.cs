using System;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.IO;
using System.Security.Cryptography;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.UI.Xaml;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Models;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.Features.Security
{
    public sealed class SecurityViewModel : ObservableObject
    {
        private const int MaxHistoryEntries = 120;

        public ObservableCollection<ConnectionEntry> History { get; } = new();
        public ObservableCollection<TrustedDeviceData> TrustedDevices { get; } = new();

        private string _token = "";
        public string Token
        {
            get => _token;
            set => SetProperty(ref _token, value);
        }

        private string _tlsFingerprint = "";
        public string TlsFingerprint
        {
            get => _tlsFingerprint;
            set => SetProperty(ref _tlsFingerprint, value);
        }

        private string _tlsPorts = "";
        public string TlsPorts
        {
            get => _tlsPorts;
            set => SetProperty(ref _tlsPorts, value);
        }

        private string _tlsExpiry = "Certificate expiry unavailable";
        public string TlsExpiry
        {
            get => _tlsExpiry;
            set => SetProperty(ref _tlsExpiry, value);
        }

        private bool _insecureHttpWarningVisible;
        public bool InsecureHttpWarningVisible
        {
            get => _insecureHttpWarningVisible;
            set => SetProperty(ref _insecureHttpWarningVisible, value);
        }

        public void ReplaceTrustedDevices(System.Collections.Generic.IReadOnlyList<TrustedDeviceData> devices)
        {
            TrustedDevices.Clear();
            foreach (var device in devices)
            {
                TrustedDevices.Add(device);
            }
        }

        public void ApplySecurityState(MainWindow mainWindow)
        {
            Token = mainWindow.CurrentToken;
            try { mainWindow.ServerManager.RefreshTlsMetadata(); } catch { }
            TlsFingerprint = mainWindow.ServerManager.TlsFingerprint;
            TlsPorts = mainWindow.ServerManager.AllowInsecureHttp
                ? "Encrypted HTTPS active · HTTP compatibility enabled"
                : "Encrypted HTTPS active · HTTP disabled";
            TlsExpiry = string.IsNullOrWhiteSpace(mainWindow.ServerManager.TlsExpiresAt)
                ? "Certificate expiry unavailable"
                : $"Expires {mainWindow.ServerManager.TlsExpiresAt}";
            InsecureHttpWarningVisible = mainWindow.ServerManager.AllowInsecureHttp;
        }

        public void RefreshTrustedDevices(PipeClient? pipeClient) => pipeClient?.RequestTrustedDevices();

        public async Task<PipeCommandAcknowledgement> RevokeTrustedDeviceAsync(
            PipeClient? pipeClient,
            string? id)
        {
            if (pipeClient == null || string.IsNullOrWhiteSpace(id))
            {
                return PipeCommandAcknowledgement.Failed(
                    "The authenticated server connection is unavailable.");
            }
            return await pipeClient.RevokeDeviceAcknowledgedAsync(id);
        }

        public async Task<PipeCommandAcknowledgement> SetAutoApproveKnownAsync(
            PipeClient pipeClient,
            bool enabled)
        {
            bool previous = AppSettingsService.AutoApproveKnownDevices;
            try
            {
                AppSettingsService.AutoApproveKnownDevices = enabled;
            }
            catch
            {
                return PipeCommandAcknowledgement.Failed(
                    "The security setting could not be saved locally.");
            }

            PipeCommandAcknowledgement result =
                await pipeClient.SetAutoApproveKnownAcknowledgedAsync(enabled);
            if (!result.Success)
            {
                try { AppSettingsService.AutoApproveKnownDevices = previous; } catch { }
            }
            return result;
        }

        public async Task<PipeCommandAcknowledgement> RegenerateTokenAsync(
            MainWindow mainWindow,
            PipeClient? pipeClient)
        {
            if (pipeClient == null)
            {
                return PipeCommandAcknowledgement.Failed(
                    "The authenticated server connection is unavailable.");
            }

            string candidate =
                Convert.ToHexString(RandomNumberGenerator.GetBytes(16))
                    .ToLowerInvariant();
            PipeCommandAcknowledgement result =
                await pipeClient.SendTokenAcknowledgedAsync(candidate);
            if (result.Success)
            {
                mainWindow.CurrentToken = candidate;
                Token = candidate;
            }
            return result;
        }

        public void CopyFingerprint() => ClipboardService.SetText(TlsFingerprint);

        public async Task<bool> ResetTlsIdentityAsync(
            XamlRoot xamlRoot,
            MainWindow mainWindow,
            PipeClient pipeClient)
        {
            if (!await DialogService.ConfirmAsync(
                    xamlRoot,
                    "Reset HTTPS server identity?",
                    "Every trusted iPhone and Windows computer will be revoked. Active native transfer grants will be cancelled, and all devices must pair again.",
                    "Reset identity",
                    "Cancel"))
            {
                return false;
            }

            PipeCommandAcknowledgement revoked =
                await pipeClient.RevokeAllDevicesAcknowledgedAsync();
            if (!revoked.Success)
            {
                await DialogService.ShowMessageAsync(
                    xamlRoot,
                    "Identity was not reset",
                    "Trusted devices could not be revoked: " + revoked.Error);
                return false;
            }
            await mainWindow.ServerManager.StopAsync();
            string directory = mainWindow.ServerManager.TlsStorageDirectory;
            File.Delete(Path.Combine(directory, "server-cert.pem"));
            File.Delete(Path.Combine(directory, "server-key.dpapi"));
            mainWindow.ServerManager.Start();
            await Task.Delay(500);
            ApplySecurityState(mainWindow);
            mainWindow.AddNetworkLog("HTTPS server identity reset; trusted devices revoked.");
            return true;
        }

        public void RebuildConnectionHistory(ObservableCollection<LogEntry> logs)
        {
            History.Clear();
            for (int i = logs.Count - 1; i >= 0; i--)
            {
                if (ConnectionHistoryMapper.TryMap(logs[i], out var historyEntry))
                {
                    History.Insert(0, historyEntry);
                }
            }
            TrimHistory();
        }

        public void ApplyNetworkLogChange(NotifyCollectionChangedEventArgs e)
        {
            if (e.NewItems == null || e.NewItems.Count == 0)
            {
                return;
            }

            foreach (var item in e.NewItems)
            {
                if (item is LogEntry logEntry && ConnectionHistoryMapper.TryMap(logEntry, out var historyEntry))
                {
                    History.Insert(0, historyEntry);
                }
            }

            TrimHistory();
        }

        private void TrimHistory()
        {
            while (History.Count > MaxHistoryEntries)
            {
                History.RemoveAt(History.Count - 1);
            }
        }
    }
}
