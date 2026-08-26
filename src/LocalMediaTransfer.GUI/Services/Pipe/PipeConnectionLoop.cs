using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    internal sealed class PipeConnectionLoop : IDisposable
    {
        private readonly string _pipeName;
        private readonly int _reconnectDelayMs;
        private readonly object _pipeLock = new();
        private readonly object _connectionStateLock = new();
        private readonly SemaphoreSlim _writeLock = new(1, 1);
        private readonly PipeSessionAuthenticator? _authenticator;
        private NamedPipeClientStream? _pipe;
        private CancellationTokenSource? _cts;
        private Task? _readTask;
        private long _runGeneration;
        private DateTime _lastConnectTimeoutLogUtc = DateTime.MinValue;
        private DateTime _lastSendFailureLogUtc = DateTime.MinValue;
        private bool _isConnected;
        private bool _disposed;

        public PipeConnectionLoop(
            string pipeName,
            int reconnectDelayMs,
            PipeSessionAuthenticator? authenticator = null)
        {
            _pipeName = pipeName;
            _reconnectDelayMs = reconnectDelayMs;
            _authenticator = authenticator;
        }

        public event Action<string>? MessageReceived;
        public event Action<bool>? ConnectionChanged;
        public event Action<string>? DiagnosticLog;

        public bool IsConnected
        {
            get
            {
                lock (_connectionStateLock)
                {
                    return _isConnected;
                }
            }
        }

        public void Start()
        {
            if (_disposed || _readTask != null)
            {
                return;
            }

            var cts = new CancellationTokenSource();
            long generation = Interlocked.Increment(ref _runGeneration);
            _cts = cts;
            _readTask = Task.Run(() => ReadLoopAsync(generation, cts.Token));
            EmitDiagnostic("PipeClient started");
        }

        public void Stop()
        {
            var cts = _cts;
            var readTask = _readTask;
            _cts = null;
            _readTask = null;
            Interlocked.Increment(ref _runGeneration);
            bool hadWork = cts != null || readTask != null || IsConnected;
            cts?.Cancel();
            DisconnectPipe();

            if (cts != null)
            {
                if (readTask == null || readTask.IsCompleted)
                {
                    cts.Dispose();
                }
                else
                {
                    _ = readTask.ContinueWith(
                        _ => cts.Dispose(),
                        CancellationToken.None,
                        TaskContinuationOptions.None,
                        TaskScheduler.Default);
                }
            }

            SetConnectionState(false);
            if (hadWork)
            {
                EmitDiagnostic("PipeClient stopped");
            }
        }

        public async Task<PipeSendResult> SendCommandAsync(
            string type,
            string data,
            string? requestId = null)
        {
            if (_disposed)
            {
                return PipeSendResult.Failed("pipe disposed");
            }

            NamedPipeClientStream? pipe;
            lock (_pipeLock)
            {
                pipe = _pipe;
            }

            if (pipe == null || !pipe.IsConnected)
            {
                return PipeSendResult.Failed("pipe disconnected");
            }

            var result = await PipeCommandSender.SendAsync(
                pipe,
                _writeLock,
                type,
                data,
                requestId);
            if (!result.Success && !_disposed)
            {
                HandleSendFailure(type, result.FailureReason ?? "unknown send failure");
            }
            return result;
        }

        private async Task ReadLoopAsync(long generation, CancellationToken ct)
        {
            var buffer = new byte[PipeMessageReader.ReadBufferSize];
            while (!ct.IsCancellationRequested && IsCurrentRun(generation))
            {
                NamedPipeClientStream? pipe = null;

                try
                {
                    pipe = new NamedPipeClientStream(
                        ".",
                        _pipeName,
                        PipeDirection.InOut,
                        PipeOptions.Asynchronous);

                    lock (_pipeLock)
                    {
                        if (!IsCurrentRun(generation))
                        {
                            pipe.Dispose();
                            break;
                        }
                        _pipe = pipe;
                    }

                    await pipe.ConnectAsync(_reconnectDelayMs, ct);
                    if (!IsCurrentRun(generation))
                    {
                        break;
                    }
                    pipe.ReadMode = PipeTransmissionMode.Message;

                    if (_authenticator != null)
                    {
                        await _authenticator.AuthenticateAsync(pipe, buffer, ct);
                    }

                    SetConnectionState(true);
                    EmitDiagnostic("PipeClient connected");

                    while (pipe.IsConnected && !ct.IsCancellationRequested)
                    {
                        var result = await PipeMessageReader.ReadMessageAsync(pipe, buffer, ct);
                        if (result.Status == PipeReadStatus.TooLarge)
                        {
                            EmitDiagnostic("PipeClient message exceeded maximum size, reconnecting");
                            break;
                        }
                        if (result.Status == PipeReadStatus.Disconnected)
                        {
                            break;
                        }

                        MessageReceived?.Invoke(result.Message!);
                    }
                }
                catch (TimeoutException)
                {
                    var now = DateTime.UtcNow;
                    if ((now - _lastConnectTimeoutLogUtc) > TimeSpan.FromSeconds(30))
                    {
                        _lastConnectTimeoutLogUtc = now;
                        EmitDiagnostic("PipeClient connect timeout (server not ready), retrying");
                    }
                    continue;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (ObjectDisposedException) when (ct.IsCancellationRequested || _disposed)
                {
                    break;
                }
                catch (IOException) when (!ct.IsCancellationRequested)
                {
                    // Pipe broken; the finally block publishes a single disconnect transition.
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    EmitDiagnostic($"PipeClient unexpected error: {ex.Message}");
                }
                finally
                {
                    DisconnectPipe(pipe);
                    if (IsCurrentRun(generation) &&
                        SetConnectionState(false) &&
                        !ct.IsCancellationRequested)
                    {
                        EmitDiagnostic("PipeClient disconnected, reconnecting");
                    }
                }

                if (!ct.IsCancellationRequested)
                {
                    try { await Task.Delay(_reconnectDelayMs, ct); } catch { }
                }
            }
        }

        private bool IsCurrentRun(long generation) =>
            generation == Interlocked.Read(ref _runGeneration);

        private void DisconnectPipe(NamedPipeClientStream? pipeToDispose = null)
        {
            NamedPipeClientStream? pipe;

            lock (_pipeLock)
            {
                pipe = pipeToDispose ?? _pipe;
                if (pipeToDispose == null || ReferenceEquals(_pipe, pipeToDispose))
                {
                    _pipe = null;
                }
            }

            try
            {
                pipe?.Dispose();
            }
            catch
            {
                // Best effort cleanup.
            }
        }

        private bool SetConnectionState(bool isConnected)
        {
            lock (_connectionStateLock)
            {
                if (_isConnected == isConnected)
                {
                    return false;
                }

                _isConnected = isConnected;
            }

            ConnectionChanged?.Invoke(isConnected);
            return true;
        }

        private void EmitDiagnostic(string message)
        {
            try
            {
                var line = $"[Pipe] {message}";
                Debug.WriteLine(line);
                DiagnosticLog?.Invoke(line);
            }
            catch
            {
                // Never let diagnostics crash transport.
            }
        }

        private void HandleSendFailure(string commandType, string reason)
        {
            var now = DateTime.UtcNow;
            if ((now - _lastSendFailureLogUtc) > TimeSpan.FromSeconds(10))
            {
                _lastSendFailureLogUtc = now;
                EmitDiagnostic($"PipeClient send failed: {reason} for command '{commandType}', requesting reconnect");
            }

            DisconnectPipe();
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            Stop();
            _cts?.Dispose();
            _writeLock.Dispose();
        }
    }
}
