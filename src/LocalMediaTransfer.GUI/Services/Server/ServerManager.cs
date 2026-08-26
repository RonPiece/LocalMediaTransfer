using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using LocalMediaTransfer.GUI.AppServices;

namespace LocalMediaTransfer.GUI.Services
{
    public enum ServerManagerState
    {
        Stopped,
        Starting,
        Running,
        Conflict,
        Faulted
    }

    /// <summary>
    /// Owns one C++ server process. An orphan from the same environment can only
    /// stop itself after an authenticated, explicitly confirmed ownership proof.
    /// </summary>
    public sealed class ServerManager : IDisposable
    {
        private const int ServerAlreadyRunningExitCode = 2;
        private const int MaxAutoRestarts = 3;
        private const int DefaultMonitorIntervalMs = 250;

        private readonly object _stateLock = new();
        private readonly IServerProcessFactory _processFactory;
        private readonly Func<string> _serverPathResolver;
        private readonly int _monitorIntervalMs;
        private readonly string _defaultUploadDirectory;
        private readonly string _pipeName;
        private readonly ServerOwnershipContext _ownershipContext;
        private readonly IServerOwnershipClient _ownershipClient;

        private IServerProcess? _ownedProcess;
        private CancellationTokenSource? _cts;
        private Task? _monitorTask;
        private long _monitorGeneration;
        private bool _disposed;
        private ServerManagerState _state = ServerManagerState.Stopped;

        public const int DefaultPort = 8443;
        public const int DefaultHttpPort = 8080;

        public ServerManager()
            : this(
                new SystemServerProcessFactory(),
                ServerPathResolver.FindServerPath,
                DefaultMonitorIntervalMs,
                ApplicationEnvironment.Current,
                ServerOwnershipContext.CreatePersistent(ApplicationEnvironment.Current),
                new ServerOwnershipClient())
        {
        }

        internal ServerManager(
            IServerProcessFactory processFactory,
            Func<string>? serverPathResolver = null,
            int monitorIntervalMs = DefaultMonitorIntervalMs,
            ApplicationEnvironmentProfile? environmentProfile = null,
            ServerOwnershipContext? ownershipContext = null,
            IServerOwnershipClient? ownershipClient = null)
        {
            var profile = environmentProfile ?? ApplicationEnvironment.Current;
            _processFactory = processFactory ?? throw new ArgumentNullException(nameof(processFactory));
            _serverPathResolver = serverPathResolver ?? ServerPathResolver.FindServerPath;
            _monitorIntervalMs = Math.Max(10, monitorIntervalMs);
            _defaultUploadDirectory = profile.DefaultUploadDirectory;
            _pipeName = profile.PipeName;
            _ownershipContext = ownershipContext ?? ServerOwnershipContext.CreateEphemeral();
            _ownershipClient = ownershipClient ?? new ServerOwnershipClient();
            Port = profile.HttpsPort;
            HttpPort = profile.HttpPort;
            RuntimeEnvironment = profile.Name;
            DataRootDirectory = profile.IsTest ? profile.DataRoot : null;
            TlsStorageDirectory = profile.TlsStorageDirectory;
            UploadDir = profile.DefaultUploadDirectory;
        }

        public int Port { get; set; }
        public int HttpPort { get; set; }
        public string RuntimeEnvironment { get; }
        public string? DataRootDirectory { get; }
        public bool AllowInsecureHttp { get; set; }
        public string TlsStorageDirectory { get; set; }
        public string TlsFingerprint { get; private set; } = "";
        public string TlsExpiresAt { get; private set; } = "";
        public string ServerId { get; private set; } = "";

        public void RefreshTlsMetadata()
        {
            var metadata = ServerTlsMetadataService.TryRead(TlsStorageDirectory);
            if (metadata == null)
            {
                return;
            }

            TlsFingerprint = metadata.Value.Fingerprint;
            TlsExpiresAt = metadata.Value.ExpiresAt;
        }

        public string UploadDir { get; set; }

        public FilenameConflictPolicy FilenameConflictPolicy { get; set; } =
            FilenameConflictPolicy.KeepBoth;

        public ServerManagerState State
        {
            get
            {
                lock (_stateLock)
                {
                    return _state;
                }
            }
        }

        public bool IsRunning
        {
            get
            {
                lock (_stateLock)
                {
                    return _state == ServerManagerState.Running &&
                           _ownedProcess != null &&
                           !_ownedProcess.HasExited;
                }
            }
        }

        public event Action<ServerManagerState>? StateChanged;
        public event Action<bool>? StatusChanged;
        public event Action<string>? ServerError;
        public event Action<string>? ServerLogReceived;

        public void Start()
        {
            ThrowIfDisposed();

            var state = State;
            if (state == ServerManagerState.Starting || state == ServerManagerState.Running)
            {
                return;
            }

            StopMonitor();
            DisposeOwnedProcessImmediately(killIfRunning: false);

            var cts = new CancellationTokenSource();
            _cts = cts;
            LaunchOwnedServer();
            long generation;
            lock (_stateLock)
            {
                generation = _monitorGeneration;
            }
            _monitorTask = Task.Run(() => MonitorLoopAsync(generation, cts.Token));
        }

        public async Task StopAsync()
        {
            StopMonitor();
            await DisposeOwnedProcessAsync(killIfRunning: true);
            SetState(ServerManagerState.Stopped);
        }

        /// <summary>
        /// Inspects the exact process behind this environment's authenticated
        /// control pipe. This method never stops a process.
        /// </summary>
        internal async Task<ServerOwnershipInspection> InspectConflictAsync(
            CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();
            if (State != ServerManagerState.Conflict)
            {
                return new(
                    ServerOwnershipStatus.Unverified,
                    null,
                    "The server manager is not in a conflict state.");
            }

            try
            {
                return await _ownershipClient.InspectAsync(
                    CreateOwnershipExpectation(),
                    cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                return new(
                    ServerOwnershipStatus.Unverified,
                    null,
                    "The existing server could not be authenticated.");
            }
        }

        /// <summary>
        /// Requests graceful self-shutdown only for a previously verified stale
        /// server. The caller must obtain explicit user confirmation first.
        /// </summary>
        internal async Task<bool> RecoverVerifiedConflictAsync(
            ServerOwnershipInspection inspection,
            CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();
            if (State != ServerManagerState.Conflict ||
                inspection.Status != ServerOwnershipStatus.VerifiedStaleOwner)
            {
                return false;
            }

            StopMonitor();
            DisposeOwnedProcessImmediately(killIfRunning: false);

            bool stopped = await _ownershipClient.RequestShutdownAsync(
                CreateOwnershipExpectation(),
                inspection,
                cancellationToken);
            if (!stopped)
            {
                ServerLogReceived?.Invoke(
                    "[GUI] Verified server ownership changed or authenticated shutdown failed.");
                return false;
            }

            SetState(ServerManagerState.Stopped);
            Start();
            return true;
        }

        private bool LaunchOwnedServer(long? expectedGeneration = null)
        {
            IServerProcess? process = null;
            try
            {
                var options = ServerLaunchOptionsBuilder.Build(
                    _serverPathResolver,
                    Port,
                    UploadDir,
                    FilenameConflictPolicy,
                    HttpPort,
                    AllowInsecureHttp,
                    TlsStorageDirectory,
                    RuntimeEnvironment,
                    _defaultUploadDirectory,
                    DataRootDirectory,
                    _ownershipContext);
                process = _processFactory.Create(options);
                process.OutputReceived += OnProcessOutput;
                process.ErrorReceived += OnProcessError;

                lock (_stateLock)
                {
                    if (expectedGeneration.HasValue &&
                        expectedGeneration.Value != _monitorGeneration)
                    {
                        process.OutputReceived -= OnProcessOutput;
                        process.ErrorReceived -= OnProcessError;
                        process.Dispose();
                        return false;
                    }
                    _ownedProcess = process;
                }

                if (!SetState(ServerManagerState.Starting, expectedGeneration))
                {
                    DisposeOwnedProcessImmediately(
                        killIfRunning: false,
                        expectedProcess: process,
                        expectedGeneration);
                    return false;
                }
                Debug.WriteLine($"[ServerManager] Launching owned server from: {options.ExecutablePath}");
                process.Start();
                return true;
            }
            catch (Exception ex)
            {
                DisposeOwnedProcessImmediately(
                    killIfRunning: true,
                    expectedProcess: process,
                    expectedGeneration);
                if (SetState(ServerManagerState.Faulted, expectedGeneration))
                {
                    ServerError?.Invoke($"Failed to start server: {ex.Message}");
                }
                return false;
            }
        }

        private async Task MonitorLoopAsync(long generation, CancellationToken ct)
        {
            var monitor = new ServerProcessMonitor(
                _monitorIntervalMs,
                MaxAutoRestarts,
                ServerAlreadyRunningExitCode,
                GetOwnedProcess,
                IsMonitorCurrent,
                generationValue => LaunchOwnedServer(generationValue),
                (process, generationValue) => DisposeOwnedProcessAsync(
                    killIfRunning: false,
                    expectedProcess: process,
                    generationValue),
                () => State,
                (state, generationValue) => SetState(state, generationValue),
                message => ServerLogReceived?.Invoke(message),
                message => ServerError?.Invoke(message));

            await monitor.RunAsync(generation, ct);
        }

        private IServerProcess? GetOwnedProcess(long generation)
        {
            lock (_stateLock)
            {
                return generation == _monitorGeneration ? _ownedProcess : null;
            }
        }

        private bool IsMonitorCurrent(long generation)
        {
            lock (_stateLock)
            {
                return generation == _monitorGeneration;
            }
        }

        private ServerOwnershipExpectation CreateOwnershipExpectation() => new(
            RuntimeEnvironment,
            "default",
            _pipeName,
            _serverPathResolver(),
            Environment.ProcessPath ?? "",
            _ownershipContext.ControlKey);

        internal PipeSessionExpectation CreatePipeSessionExpectation()
        {
            lock (_stateLock)
            {
                if (_ownedProcess == null || _ownedProcess.HasExited)
                {
                    throw new InvalidOperationException(
                        "There is no live owned server for pipe authentication.");
                }
                return new PipeSessionExpectation(
                    _ownedProcess.Id,
                    _ownedProcess.StartTimeUtcFileTime,
                    _ownershipContext.OwnerProcessId,
                    _ownershipContext.OwnerProcessStartTimeUtcFileTime,
                    RuntimeEnvironment,
                    "default",
                    _ownershipContext.ControlInstanceId,
                    _pipeName,
                    _ownershipContext.ControlKey);
            }
        }

        private async Task<bool> DisposeOwnedProcessAsync(
            bool killIfRunning,
            IServerProcess? expectedProcess = null,
            long? expectedGeneration = null)
        {
            IServerProcess? process = DetachOwnedProcess(expectedProcess, expectedGeneration);
            if (process == null)
            {
                return false;
            }

            process.OutputReceived -= OnProcessOutput;
            process.ErrorReceived -= OnProcessError;

            try
            {
                if (killIfRunning && !process.HasExited)
                {
                    process.Kill();
                    await process.WaitForExitAsync(TimeSpan.FromSeconds(3));
                }
            }
            catch
            {
                // Best-effort shutdown of the process this manager owns.
            }
            finally
            {
                process.Dispose();
            }
            return true;
        }

        private bool DisposeOwnedProcessImmediately(
            bool killIfRunning,
            IServerProcess? expectedProcess = null,
            long? expectedGeneration = null)
        {
            IServerProcess? process = DetachOwnedProcess(expectedProcess, expectedGeneration);
            if (process == null)
            {
                return false;
            }

            process.OutputReceived -= OnProcessOutput;
            process.ErrorReceived -= OnProcessError;

            try
            {
                if (killIfRunning && !process.HasExited)
                {
                    process.Kill();
                }
            }
            catch
            {
                // Best-effort shutdown for application disposal or failed launch.
            }
            finally
            {
                process.Dispose();
            }
            return true;
        }

        private IServerProcess? DetachOwnedProcess(
            IServerProcess? expectedProcess,
            long? expectedGeneration)
        {
            lock (_stateLock)
            {
                if (expectedGeneration.HasValue &&
                    expectedGeneration.Value != _monitorGeneration)
                {
                    return null;
                }
                if (expectedProcess != null &&
                    !ReferenceEquals(_ownedProcess, expectedProcess))
                {
                    return null;
                }

                IServerProcess? process = _ownedProcess;
                _ownedProcess = null;
                return process;
            }
        }

        private void StopMonitor()
        {
            var cts = _cts;
            var monitorTask = _monitorTask;
            _cts = null;
            _monitorTask = null;
            lock (_stateLock)
            {
                _monitorGeneration++;
            }

            cts?.Cancel();
            if (cts == null)
            {
                return;
            }

            if (monitorTask == null || monitorTask.IsCompleted)
            {
                cts.Dispose();
                return;
            }

            _ = monitorTask.ContinueWith(
                _ => cts.Dispose(),
                CancellationToken.None,
                TaskContinuationOptions.None,
                TaskScheduler.Default);
        }

        private bool SetState(
            ServerManagerState state,
            long? expectedGeneration = null)
        {
            lock (_stateLock)
            {
                if (expectedGeneration.HasValue &&
                    expectedGeneration.Value != _monitorGeneration)
                {
                    return false;
                }
                if (_state == state)
                {
                    return true;
                }

                _state = state;
            }

            StateChanged?.Invoke(state);
            StatusChanged?.Invoke(state == ServerManagerState.Running);
            return true;
        }

        private void OnProcessOutput(string message)
        {
            const string fingerprintPrefix = "TLS certificate SHA-256: ";
            const string expiryPrefix = "TLS certificate expires: ";
            const string serverIdPrefix = "Server ID: ";
            int fingerprintIndex = message.IndexOf(fingerprintPrefix, StringComparison.OrdinalIgnoreCase);
            if (fingerprintIndex >= 0)
            {
                TlsFingerprint = message[(fingerprintIndex + fingerprintPrefix.Length)..].Trim();
            }
            int expiryIndex = message.IndexOf(expiryPrefix, StringComparison.OrdinalIgnoreCase);
            if (expiryIndex >= 0)
            {
                TlsExpiresAt = message[(expiryIndex + expiryPrefix.Length)..].Trim();
            }
            int serverIdIndex = message.IndexOf(serverIdPrefix, StringComparison.OrdinalIgnoreCase);
            if (serverIdIndex >= 0)
            {
                ServerId = message[(serverIdIndex + serverIdPrefix.Length)..].Trim();
            }
            if (string.IsNullOrEmpty(TlsFingerprint))
            {
                try { RefreshTlsMetadata(); } catch { }
            }
            ServerLogReceived?.Invoke("[C++] " + SecretRedactor.Redact(message));
        }

        private void OnProcessError(string message)
        {
            ServerLogReceived?.Invoke("[C++ ERR] " + SecretRedactor.Redact(message));
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(ServerManager));
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            StopMonitor();
            DisposeOwnedProcessImmediately(killIfRunning: true);
            CryptographicOperations.ZeroMemory(_ownershipContext.ControlKey);
            SetState(ServerManagerState.Stopped);
        }
    }
}
