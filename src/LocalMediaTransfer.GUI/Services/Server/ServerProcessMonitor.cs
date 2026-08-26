using System;
using System.Threading;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    internal sealed class ServerProcessMonitor
    {
        private readonly int _monitorIntervalMs;
        private readonly int _maxAutoRestarts;
        private readonly int _serverAlreadyRunningExitCode;
        private readonly Func<long, IServerProcess?> _getOwnedProcess;
        private readonly Func<long, bool> _isMonitorCurrent;
        private readonly Func<long, bool> _launchOwnedServer;
        private readonly Func<IServerProcess, long, Task<bool>> _disposeExitedOwnedProcess;
        private readonly Func<ServerManagerState> _getState;
        private readonly Func<ServerManagerState, long, bool> _setState;
        private readonly Action<string> _log;
        private readonly Action<string> _error;
        private int _restartCount;

        public ServerProcessMonitor(
            int monitorIntervalMs,
            int maxAutoRestarts,
            int serverAlreadyRunningExitCode,
            Func<long, IServerProcess?> getOwnedProcess,
            Func<long, bool> isMonitorCurrent,
            Func<long, bool> launchOwnedServer,
            Func<IServerProcess, long, Task<bool>> disposeExitedOwnedProcess,
            Func<ServerManagerState> getState,
            Func<ServerManagerState, long, bool> setState,
            Action<string> log,
            Action<string> error)
        {
            _monitorIntervalMs = monitorIntervalMs;
            _maxAutoRestarts = maxAutoRestarts;
            _serverAlreadyRunningExitCode = serverAlreadyRunningExitCode;
            _getOwnedProcess = getOwnedProcess;
            _isMonitorCurrent = isMonitorCurrent;
            _launchOwnedServer = launchOwnedServer;
            _disposeExitedOwnedProcess = disposeExitedOwnedProcess;
            _getState = getState;
            _setState = setState;
            _log = log;
            _error = error;
        }

        public async Task RunAsync(long generation, CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(_monitorIntervalMs, ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                var process = _getOwnedProcess(generation);
                if (process == null)
                {
                    break;
                }

                bool hasExited;
                try
                {
                    hasExited = process.HasExited;
                }
                catch (Exception ex)
                {
                    if (_setState(ServerManagerState.Faulted, generation))
                    {
                        _error($"Unable to monitor server process: {ex.Message}");
                    }
                    break;
                }

                if (!hasExited)
                {
                    if (_getState() == ServerManagerState.Starting)
                    {
                        _setState(ServerManagerState.Running, generation);
                    }
                    continue;
                }

                int exitCode;
                try
                {
                    exitCode = process.ExitCode;
                }
                catch
                {
                    exitCode = -1;
                }

                if (!await _disposeExitedOwnedProcess(process, generation))
                {
                    break;
                }

                if (exitCode == _serverAlreadyRunningExitCode)
                {
                    _log("[GUI] Another server is already running. It was left untouched.");
                    _setState(ServerManagerState.Conflict, generation);
                    break;
                }

                if (!ct.IsCancellationRequested &&
                    _isMonitorCurrent(generation) &&
                    _restartCount < _maxAutoRestarts)
                {
                    _restartCount++;
                    _log($"[GUI] Owned server exited with code {exitCode}; restart {_restartCount}/{_maxAutoRestarts}.");
                    if (!_launchOwnedServer(generation))
                    {
                        break;
                    }
                    continue;
                }

                if (_setState(ServerManagerState.Faulted, generation))
                {
                    _error($"Server exited with code {exitCode} and could not be restarted.");
                }
                break;
            }
        }
    }
}
