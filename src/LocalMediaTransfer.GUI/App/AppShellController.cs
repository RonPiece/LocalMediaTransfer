using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Threading;
using System.Collections.Generic;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using LocalMediaTransfer.GUI.Models;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.AppServices
{
    public enum AppShellStatusKind
    {
        Starting,
        Connecting,
        Running,
        Conflict,
        Error,
        Stopped
    }

    public sealed class AppShellController : IDisposable
    {
        private readonly DispatcherQueue _dispatcherQueue;
        private readonly Func<XamlRoot?> _xamlRootProvider;
        private readonly Action<AppShellStatusKind> _setStatus;
        private readonly NetworkLogService _networkLogService = new();
        private DateTimeOffset _suppressDisconnectLogsUntilUtc = DateTimeOffset.MinValue;
        private bool _isConflictDialogOpen;
        private readonly Queue<ApprovalPrompt> _approvalQueue = new();
        private readonly HashSet<string> _queuedApprovalIds = new(StringComparer.Ordinal);
        private bool _approvalPumpActive;
        private bool _cleanupStarted;
        private bool _isSubscribed;
        private Task? _cleanupTask;
        private int _pipeSyncGeneration;

        public AppShellController(
            DispatcherQueue dispatcherQueue,
            Func<XamlRoot?> xamlRootProvider,
            Action<AppShellStatusKind> setStatus)
        {
            _dispatcherQueue = dispatcherQueue ?? throw new ArgumentNullException(nameof(dispatcherQueue));
            _xamlRootProvider = xamlRootProvider ?? throw new ArgumentNullException(nameof(xamlRootProvider));
            _setStatus = setStatus ?? throw new ArgumentNullException(nameof(setStatus));
            ServerManager = new ServerManager();
            PipeClient = new PipeClient(
                ApplicationEnvironment.Current.PipeName,
                2000,
                new PipeSessionAuthenticator(
                    ServerManager.CreatePipeSessionExpectation));
            CurrentToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        }

        public ServerManager ServerManager { get; }
        public PipeClient PipeClient { get; }
        public string CurrentToken { get; set; }
        public ObservableCollection<LogEntry> NetworkLogs => _networkLogService.Entries;
        public bool IsClosing { get; private set; }
        public event Action<int>? PendingApprovalCountChanged;

        public void Start()
        {
            ApplyPersistedServerSettings();
            Subscribe();
            ServerManager.Start();
            AddNetworkLog("GUI Started");
        }

        private void ApplyPersistedServerSettings()
        {
            if (!ApplicationEnvironment.Current.IsTest)
            {
                var uploadDir = AppSettingsService.UploadDirectory;
                if (!string.IsNullOrWhiteSpace(uploadDir))
                {
                    ServerManager.UploadDir = uploadDir;
                }
            }

            ServerManager.AllowInsecureHttp = AppSettingsService.AllowInsecureHttp;
            ServerManager.FilenameConflictPolicy = AppSettingsService.FilenameConflictPolicy;
        }

        private void Subscribe()
        {
            if (_isSubscribed)
            {
                return;
            }

            _isSubscribed = true;
            ServerManager.StateChanged += OnServerStateChanged;
            ServerManager.ServerError += OnServerError;
            ServerManager.ServerLogReceived += OnServerLogReceived;
            PipeClient.ConnectionChanged += OnPipeConnectionChanged;
            PipeClient.DiagnosticLog += OnPipeDiagnosticLog;
            PipeClient.LogReceived += OnPipeLogReceived;
            PipeClient.PairingRequested += OnPairingRequested;
            PipeClient.NativePairingRequested += OnNativePairingRequested;
            PipeClient.NativeTransferRequested += OnNativeTransferRequested;
        }

        public void AddNetworkLog(string message, DateTimeOffset? timestamp = null)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return;
            }

            var entryTimestamp = timestamp ?? DateTimeOffset.Now;

            void AddOnUiThread()
            {
                if (!IsClosing)
                {
                    _networkLogService.Add(message, entryTimestamp);
                }
            }

            if (_dispatcherQueue.HasThreadAccess)
            {
                AddOnUiThread();
            }
            else
            {
                _dispatcherQueue.TryEnqueue(AddOnUiThread);
            }
        }

        public async Task RestartServerAsync(string logMessage, bool suppressDisconnectLog = false)
        {
            if (suppressDisconnectLog)
            {
                _suppressDisconnectLogsUntilUtc = DateTimeOffset.UtcNow.AddSeconds(12);
            }

            await ServerManager.StopAsync();
            ServerManager.Start();
            AddNetworkLog(logMessage);
        }

        public Task CleanupForExitAsync()
        {
            return _cleanupTask ??= CleanupForExitCoreAsync();
        }

        private async Task CleanupForExitCoreAsync()
        {
            if (_cleanupStarted)
            {
                return;
            }

            _cleanupStarted = true;
            IsClosing = true;

            if (_isSubscribed)
            {
                ServerManager.StateChanged -= OnServerStateChanged;
                ServerManager.ServerError -= OnServerError;
                ServerManager.ServerLogReceived -= OnServerLogReceived;
                PipeClient.ConnectionChanged -= OnPipeConnectionChanged;
                PipeClient.DiagnosticLog -= OnPipeDiagnosticLog;
                PipeClient.LogReceived -= OnPipeLogReceived;
                PipeClient.PairingRequested -= OnPairingRequested;
                PipeClient.NativePairingRequested -= OnNativePairingRequested;
                PipeClient.NativeTransferRequested -= OnNativeTransferRequested;
                _isSubscribed = false;
            }

            PipeClient.Dispose();
            await ServerManager.StopAsync();
            ServerManager.Dispose();
        }

        private void OnPairingRequested(PairingRequestData request)
        {
            QueueApproval("ios:" + request.DeviceId, async xamlRoot =>
            {
                bool approved = await DialogService.ConfirmAsync(
                    xamlRoot,
                    "Allow this iPhone?",
                    $"{request.DeviceName}\n{request.IpAddress}\n\nOnly approve a device you recognize on your private network.",
                    "Allow",
                    "Deny",
                    ContentDialogButton.Primary);
                PipeCommandAcknowledgement result = approved
                    ? await PipeClient.ApproveDeviceAcknowledgedAsync(request.DeviceId)
                    : await PipeClient.DenyDeviceAcknowledgedAsync(request.DeviceId);
                AddNetworkLog(result.Success
                    ? $"iPhone {(approved ? "approved" : "denied")}: {request.DeviceName} ({request.IpAddress})"
                    : "Device decision was not applied: " + result.Error);
            });
        }

        private void OnNativePairingRequested(NativePairingRequestData request)
        {
            QueueApproval("windows-pair:" + request.RequestId, async xamlRoot =>
            {
                bool approved = await DialogService.ConfirmAsync(
                    xamlRoot,
                    "Pair this Windows computer?",
                    $"{request.DeviceName}\n{request.IpAddress}\n\nSecurity code: {request.SecurityCode}\n\nCompare this code with the sender. Approve only when both codes match.",
                    "Codes Match — Pair",
                    "Deny",
                    ContentDialogButton.Primary);
                PipeCommandAcknowledgement result = approved
                    ? await PipeClient.ApproveNativePairingAcknowledgedAsync(request.RequestId)
                    : await PipeClient.DenyNativePairingAcknowledgedAsync(request.RequestId);
                AddNetworkLog(result.Success
                    ? $"Windows pairing {(approved ? "approved" : "denied")}: {request.DeviceName} ({request.IpAddress})"
                    : "Windows pairing decision was not applied: " + result.Error);
            });
        }

        private void OnNativeTransferRequested(NativeTransferRequestData request)
        {
            QueueApproval("windows-transfer:" + request.RequestId, async xamlRoot =>
            {
                var details = new Expander
                {
                    Header = "File details",
                    Content = new TextBlock
                    {
                        Text = request.SampleNames.Count == 0
                            ? "No filenames supplied."
                            : string.Join("\n", request.SampleNames),
                        TextWrapping = TextWrapping.Wrap
                    }
                };
                var content = new StackPanel { Spacing = 10 };
                content.Children.Add(new TextBlock
                {
                    Text = $"{request.DeviceName}\n{request.IpAddress}\n\n{request.FileCount:N0} files · {FormatBytes(request.TotalBytes)}\n\nApprove only if you expect this transfer.",
                    TextWrapping = TextWrapping.Wrap
                });
                content.Children.Add(details);
                var dialog = new ContentDialog
                {
                    Title = "Allow incoming Windows transfer?",
                    Content = content,
                    PrimaryButtonText = "Allow Transfer",
                    CloseButtonText = "Deny",
                    DefaultButton = ContentDialogButton.Primary,
                    XamlRoot = xamlRoot
                };
                bool approved = await dialog.ShowAsync() == ContentDialogResult.Primary;
                PipeCommandAcknowledgement result = approved
                    ? await PipeClient.ApproveNativeTransferAcknowledgedAsync(request.RequestId)
                    : await PipeClient.DenyNativeTransferAcknowledgedAsync(request.RequestId);
                AddNetworkLog(result.Success
                    ? $"Incoming Windows transfer {(approved ? "approved" : "denied")}: {request.FileCount} files from {request.DeviceName}"
                    : "Transfer decision was not applied: " + result.Error);
            });
        }

        private void QueueApproval(string key, Func<XamlRoot, Task> handler)
        {
            if (IsClosing || string.IsNullOrWhiteSpace(key)) return;
            _dispatcherQueue.TryEnqueue(() =>
            {
                if (IsClosing || !_queuedApprovalIds.Add(key)) return;
                _approvalQueue.Enqueue(new ApprovalPrompt(key, handler));
                PendingApprovalCountChanged?.Invoke(_approvalQueue.Count +
                    (_approvalPumpActive ? 1 : 0));
                _ = ProcessApprovalQueueAsync();
            });
        }

        private async Task ProcessApprovalQueueAsync()
        {
            if (_approvalPumpActive || IsClosing) return;
            _approvalPumpActive = true;
            try
            {
                while (_approvalQueue.TryDequeue(out ApprovalPrompt? prompt))
                {
                    PendingApprovalCountChanged?.Invoke(_approvalQueue.Count + 1);
                    XamlRoot? root = _xamlRootProvider();
                    if (IsClosing)
                    {
                        _queuedApprovalIds.Remove(prompt.Key);
                        break;
                    }
                    if (root == null)
                    {
                        _approvalQueue.Enqueue(prompt);
                        await Task.Delay(250);
                        continue;
                    }
                    try { await prompt.Handler(root); }
                    catch (Exception exception)
                    {
                        AddNetworkLog("Approval prompt failed: " + exception.Message);
                    }
                    finally { _queuedApprovalIds.Remove(prompt.Key); }
                }
            }
            finally
            {
                _approvalPumpActive = false;
                PendingApprovalCountChanged?.Invoke(_approvalQueue.Count);
            }
        }

        private static string FormatBytes(long bytes) => bytes >= 1_000_000_000
            ? $"{bytes / 1_000_000_000d:N1} GB"
            : bytes >= 1_000_000 ? $"{bytes / 1_000_000d:N1} MB"
            : $"{bytes / 1_000d:N1} KB";

        private sealed record ApprovalPrompt(string Key, Func<XamlRoot, Task> Handler);

        private void OnServerLogReceived(string log)
        {
            Debug.WriteLine(log);

            if (ServerLogClassifier.IsImportant(log))
            {
                AddNetworkLog(log);
            }
        }

        private void OnServerError(string errorMessage)
        {
            App.LogDiagnostic("ServerManager", errorMessage);
            AddNetworkLog("[Server Error] " + errorMessage);

            if (IsClosing)
            {
                return;
            }

            _dispatcherQueue.TryEnqueue(async () =>
            {
                var xamlRoot = _xamlRootProvider();
                if (IsClosing || xamlRoot == null)
                {
                    return;
                }

                var dialog = new ContentDialog
                {
                    Title = "Server Error",
                    Content = errorMessage,
                    CloseButtonText = "OK",
                    XamlRoot = xamlRoot
                };

                try
                {
                    await dialog.ShowAsync();
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"Failed to show error dialog: {ex.Message}");
                }
            });
        }

        private void OnServerStateChanged(ServerManagerState state)
        {
            if (IsClosing)
            {
                return;
            }

            _dispatcherQueue.TryEnqueue(() =>
            {
                if (IsClosing)
                {
                    return;
                }

                switch (state)
                {
                    case ServerManagerState.Starting:
                        PipeClient.Stop();
                        _setStatus(AppShellStatusKind.Starting);
                        break;
                    case ServerManagerState.Running:
                        _setStatus(AppShellStatusKind.Connecting);
                        PipeClient.Start();
                        break;
                    case ServerManagerState.Conflict:
                        PipeClient.Stop();
                        _setStatus(AppShellStatusKind.Conflict);
                        AddNetworkLog("Another server is already running. It was left untouched.");
                        _ = ShowServerConflictDialogAsync();
                        break;
                    case ServerManagerState.Faulted:
                        PipeClient.Stop();
                        _setStatus(AppShellStatusKind.Error);
                        break;
                    default:
                        PipeClient.Stop();
                        _setStatus(AppShellStatusKind.Stopped);
                        break;
                }
            });
        }

        private async Task ShowServerConflictDialogAsync()
        {
            var xamlRoot = _xamlRootProvider();
            if (_isConflictDialogOpen || IsClosing || xamlRoot == null)
            {
                return;
            }

            _isConflictDialogOpen = true;
            try
            {
                ServerOwnershipInspection inspection =
                    await ServerManager.InspectConflictAsync();
                if (inspection.Status == ServerOwnershipStatus.VerifiedStaleOwner &&
                    inspection.Proof != null)
                {
                    bool confirmed = await DialogService.ConfirmAsync(
                        xamlRoot,
                        "Verified Stale Server",
                        $"Local Media Transfer authenticated server process " +
                        $"{inspection.Proof.ServerProcessId}, matched its creation time, " +
                        "environment, instance, executable, and local control pipe, and " +
                        "confirmed that its original GUI owner is no longer running.\n\n" +
                        "Stop that verified server gracefully and restart it under this window?",
                        "Stop and Restart",
                        "Leave Running",
                        ContentDialogButton.Primary);
                    if (confirmed)
                    {
                        bool recovered = await ServerManager.RecoverVerifiedConflictAsync(
                            inspection);
                        AddNetworkLog(recovered
                            ? "Verified stale server stopped gracefully; starting a new owned server."
                            : "Stale-server recovery was cancelled because ownership changed or authentication failed.");
                    }
                }
                else
                {
                    string guidance = inspection.Status == ServerOwnershipStatus.ActiveOwner
                        ? inspection.Explanation +
                          " Close the other Local Media Transfer window or use its tray Exit command."
                        : inspection.Explanation +
                          " For safety, this process will not be stopped automatically.";
                    await DialogService.ConfirmAsync(
                        xamlRoot,
                        "Server Already Running",
                        guidance,
                        "OK",
                        "Cancel");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to show server conflict dialog: {ex.Message}");
            }
            finally
            {
                _isConflictDialogOpen = false;
            }
        }

        private void OnPipeConnectionChanged(bool isConnected)
        {
            if (IsClosing)
            {
                return;
            }

            int generation = Interlocked.Increment(ref _pipeSyncGeneration);
            _dispatcherQueue.TryEnqueue(async () =>
            {
                if (IsClosing)
                {
                    return;
                }

                if (isConnected && ServerManager.State == ServerManagerState.Running)
                {
                    _setStatus(AppShellStatusKind.Connecting);
                    PipeCommandAcknowledgement synchronized =
                        await SecurityStateReconciler.ReconcileAsync(
                            PipeClient,
                            CurrentToken,
                            AppSettingsService.AutoApproveKnownDevices,
                            AppSettingsService.NearbyDesktopDiscovery);
                    if (generation != Volatile.Read(ref _pipeSyncGeneration) ||
                        !PipeClient.IsConnected ||
                        ServerManager.State != ServerManagerState.Running)
                    {
                        return;
                    }

                    if (!synchronized.Success)
                    {
                        _setStatus(AppShellStatusKind.Error);
                        AddNetworkLog(
                            "Security state could not be synchronized with the server: " +
                            synchronized.Error);
                        return;
                    }

                    _setStatus(AppShellStatusKind.Running);
                    AddNetworkLog("Connected to authenticated background server");
                    RecordTestSecuritySync();
                    Debug.WriteLine(
                        "[AppShellController] Security state synchronized after authenticated pipe connection.");
                }
                else if (ServerManager.State == ServerManagerState.Running)
                {
                    _setStatus(AppShellStatusKind.Connecting);
                    if (!ShouldSuppressDisconnectLog())
                    {
                        AddNetworkLog("Lost connection to server");
                    }
                }
            });
        }

        private static void RecordTestSecuritySync()
        {
            if (!ApplicationEnvironment.Current.IsTest)
            {
                return;
            }

            try
            {
                string marker = Path.Combine(
                    ApplicationEnvironment.Current.DataRoot,
                    "authenticated-security-sync.ok");
                File.WriteAllText(marker, "acknowledged");
            }
            catch (Exception ex)
            {
                App.LogDiagnostic(
                    "AppShellController",
                    "Unable to write the TEST security-sync marker: " + ex.Message);
            }
        }

        private bool ShouldSuppressDisconnectLog()
        {
            if (DateTimeOffset.UtcNow <= _suppressDisconnectLogsUntilUtc)
            {
                return true;
            }

            _suppressDisconnectLogsUntilUtc = DateTimeOffset.MinValue;
            return false;
        }

        private void OnPipeLogReceived(LogData log)
        {
            var timestamp = PipeTimestampParser.Parse(log.Timestamp);
            AddNetworkLog(
                SecretRedactor.Redact($"[{log.Level}] {log.Message}"),
                timestamp);
        }

        private void OnPipeDiagnosticLog(string message)
        {
            AddNetworkLog(SecretRedactor.Redact(message));
        }

        public void Dispose()
        {
            _ = CleanupForExitAsync();
        }
    }
}
