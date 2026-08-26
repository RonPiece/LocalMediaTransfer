using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    /// <summary>
    /// Named Pipe client facade for the C++ server's LocalMediaTransferPipe.
    /// Connection/reconnect, command sending, and parsing live in focused helpers.
    /// </summary>
    public sealed class PipeClient : IDisposable
    {
        private const string PipeName = "LocalMediaTransferPipe";
        private const int ReconnectDelayMs = 2000;

        private readonly PipeConnectionLoop _connectionLoop;
        private readonly ConcurrentDictionary<string, TaskCompletionSource<PipeCommandAcknowledgement>>
            _pendingCommands = new();
        private bool _disposed;

        public PipeClient(
            string pipeName = PipeName,
            int reconnectDelayMs = ReconnectDelayMs)
            : this(pipeName, reconnectDelayMs, null)
        {
        }

        internal PipeClient(
            string pipeName,
            int reconnectDelayMs,
            PipeSessionAuthenticator? authenticator)
        {
            if (string.IsNullOrWhiteSpace(pipeName))
            {
                throw new ArgumentException("Pipe name is required.", nameof(pipeName));
            }

            _connectionLoop = new PipeConnectionLoop(
                pipeName,
                Math.Max(10, reconnectDelayMs),
                authenticator);
            _connectionLoop.MessageReceived += ProcessMessage;
            _connectionLoop.ConnectionChanged += connected =>
            {
                if (!connected)
                {
                    FailPendingCommands("The authenticated server connection was lost.");
                }
                ConnectionChanged?.Invoke(connected);
            };
            _connectionLoop.DiagnosticLog += message => DiagnosticLog?.Invoke(message);
        }

        public event Action<MetricsData>? MetricsReceived;
        public event Action<LogData>? LogReceived;
        public event Action<IReadOnlyList<TransferHistoryData>>? TransferHistoryReceived;
        public event Action<PairingRequestData>? PairingRequested;
        public event Action<NativePairingRequestData>? NativePairingRequested;
        public event Action<NativeTransferRequestData>? NativeTransferRequested;
        public event Action<IReadOnlyList<TrustedDeviceData>>? TrustedDevicesReceived;
        public event Action<bool>? ConnectionChanged;
        public event Action<string>? DiagnosticLog;

        public bool IsConnected => _connectionLoop.IsConnected;

        public void Start()
        {
            if (!_disposed)
            {
                _connectionLoop.Start();
            }
        }

        public void Stop()
        {
            _connectionLoop.Stop();
        }

        private void SendCommand(string type, string data)
        {
            if (_disposed || !IsConnected)
            {
                return;
            }

            _ = _connectionLoop.SendCommandAsync(type, data);
        }

        internal Task<PipeSendResult> SendCommandAsync(string type, string data) =>
            _connectionLoop.SendCommandAsync(type, data);

        public async Task<PipeCommandAcknowledgement> SendAcknowledgedCommandAsync(
            string type,
            string data,
            TimeSpan? timeout = null)
        {
            if (_disposed || !IsConnected)
            {
                return PipeCommandAcknowledgement.Failed(
                    "The authenticated server connection is unavailable.");
            }

            string requestId = Convert.ToHexString(
                RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            var completion = new TaskCompletionSource<PipeCommandAcknowledgement>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            if (!_pendingCommands.TryAdd(requestId, completion))
            {
                return PipeCommandAcknowledgement.Failed(
                    "Could not allocate a command identifier.");
            }

            PipeSendResult sent = await _connectionLoop.SendCommandAsync(
                type,
                data,
                requestId);
            if (!sent.Success)
            {
                _pendingCommands.TryRemove(requestId, out _);
                return PipeCommandAcknowledgement.Failed(
                    sent.FailureReason ?? "The command could not be sent.");
            }

            try
            {
                return await completion.Task.WaitAsync(
                    timeout ?? TimeSpan.FromSeconds(5));
            }
            catch (TimeoutException)
            {
                return PipeCommandAcknowledgement.Failed(
                    "The server did not acknowledge the command in time.");
            }
            finally
            {
                _pendingCommands.TryRemove(requestId, out _);
            }
        }

        public Task<PipeCommandAcknowledgement> SendTokenAcknowledgedAsync(string token) =>
            SendAcknowledgedCommandAsync("set_token", token);
        public void RequestTransferHistory() => SendCommand("request_transfer_history", "");
        public Task<PipeCommandAcknowledgement> ClearTransferHistoryAcknowledgedAsync() =>
            SendAcknowledgedCommandAsync("clear_transfer_history", "");
        public Task<PipeCommandAcknowledgement> ApproveDeviceAcknowledgedAsync(string id) =>
            SendAcknowledgedCommandAsync("approve_device", id);
        public Task<PipeCommandAcknowledgement> DenyDeviceAcknowledgedAsync(string id) =>
            SendAcknowledgedCommandAsync("deny_device", id);
        public Task<PipeCommandAcknowledgement> RevokeDeviceAcknowledgedAsync(string id) =>
            SendAcknowledgedCommandAsync("revoke_device", id);
        public void RequestTrustedDevices() => SendCommand("request_trusted_devices", "");
        public Task<PipeCommandAcknowledgement> RevokeAllDevicesAcknowledgedAsync() =>
            SendAcknowledgedCommandAsync("revoke_all_devices", "");
        public Task<PipeCommandAcknowledgement> SetAutoApproveKnownAcknowledgedAsync(bool enabled) =>
            SendAcknowledgedCommandAsync("set_auto_approve_known", enabled ? "true" : "false");
        public Task<PipeCommandAcknowledgement> SetDiscoveryEnabledAcknowledgedAsync(bool enabled) =>
            SendAcknowledgedCommandAsync("set_discovery_enabled", enabled ? "true" : "false");
        public Task<PipeCommandAcknowledgement> SetBrowserBootstrapAcknowledgedAsync(
            string bootstrap) =>
            SendAcknowledgedCommandAsync("set_browser_bootstrap", bootstrap);
        public Task<PipeCommandAcknowledgement> BeginNativePairingAcknowledgedAsync() =>
            SendAcknowledgedCommandAsync("begin_native_pairing", "120");
        public Task<PipeCommandAcknowledgement> EndNativePairingAcknowledgedAsync() =>
            SendAcknowledgedCommandAsync("end_native_pairing", "");
        public Task<PipeCommandAcknowledgement> ApproveNativePairingAcknowledgedAsync(string id) =>
            SendAcknowledgedCommandAsync("approve_native_pairing", id);
        public Task<PipeCommandAcknowledgement> DenyNativePairingAcknowledgedAsync(string id) =>
            SendAcknowledgedCommandAsync("deny_native_pairing", id);
        public Task<PipeCommandAcknowledgement> ApproveNativeTransferAcknowledgedAsync(string id) =>
            SendAcknowledgedCommandAsync("approve_native_transfer", id);
        public Task<PipeCommandAcknowledgement> DenyNativeTransferAcknowledgedAsync(string id) =>
            SendAcknowledgedCommandAsync("deny_native_transfer", id);

        private void ProcessMessage(string json)
        {
            var result = PipeMessageParser.Parse(json);
            if (!result.Success)
            {
                if (!string.IsNullOrWhiteSpace(result.Diagnostic))
                {
                    DiagnosticLog?.Invoke($"[Pipe] {result.Diagnostic}");
                }
                return;
            }

            var message = result.Message;
            if (message == null)
            {
                return;
            }

            switch (message.Kind)
            {
                case PipeMessageKind.Metrics:
                    MetricsReceived?.Invoke((MetricsData)message.Payload!);
                    break;
                case PipeMessageKind.Log:
                    LogReceived?.Invoke((LogData)message.Payload!);
                    break;
                case PipeMessageKind.TransferHistory:
                    TransferHistoryReceived?.Invoke((IReadOnlyList<TransferHistoryData>)message.Payload!);
                    break;
                case PipeMessageKind.PairingRequest:
                    PairingRequested?.Invoke((PairingRequestData)message.Payload!);
                    break;
                case PipeMessageKind.NativePairingRequest:
                    NativePairingRequested?.Invoke((NativePairingRequestData)message.Payload!);
                    break;
                case PipeMessageKind.NativeTransferRequest:
                    NativeTransferRequested?.Invoke((NativeTransferRequestData)message.Payload!);
                    break;
                case PipeMessageKind.TrustedDevices:
                    TrustedDevicesReceived?.Invoke((IReadOnlyList<TrustedDeviceData>)message.Payload!);
                    break;
                case PipeMessageKind.CommandResult:
                    var commandResult = (CommandResultData)message.Payload!;
                    if (_pendingCommands.TryRemove(
                            commandResult.RequestId,
                            out var completion))
                    {
                        completion.TrySetResult(commandResult.Success
                            ? PipeCommandAcknowledgement.Ok()
                            : PipeCommandAcknowledgement.Failed(commandResult.Error));
                    }
                    break;
            }
        }

        private void FailPendingCommands(string error)
        {
            foreach (var pending in _pendingCommands)
            {
                if (_pendingCommands.TryRemove(pending.Key, out var completion))
                {
                    completion.TrySetResult(PipeCommandAcknowledgement.Failed(error));
                }
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            FailPendingCommands("The pipe client was disposed.");
            _connectionLoop.MessageReceived -= ProcessMessage;
            _connectionLoop.Dispose();
        }
    }
}
