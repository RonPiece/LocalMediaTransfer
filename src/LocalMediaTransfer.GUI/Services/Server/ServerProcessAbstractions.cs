using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Threading;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    public enum FilenameConflictPolicy
    {
        KeepBoth,
        Reject
    }

    public sealed record ServerLaunchOptions(
        string ExecutablePath,
        int Port,
        string UploadDirectory,
        FilenameConflictPolicy FilenameConflictPolicy,
        int HttpPort = 8080,
        bool AllowInsecureHttp = false,
        string? TlsStorageDirectory = null,
        string EnvironmentName = "production",
        string? DataRootDirectory = null,
        string? ControlToken = null,
        int OwnerProcessId = 0,
        long OwnerProcessStartTimeUtcFileTime = 0,
        string? ControlInstanceId = null);

    public interface IServerProcess : IDisposable
    {
        event Action<string>? OutputReceived;
        event Action<string>? ErrorReceived;

        int Id { get; }
        long StartTimeUtcFileTime { get; }
        bool HasExited { get; }
        int ExitCode { get; }

        void Start();
        void Kill();
        Task<bool> WaitForExitAsync(TimeSpan timeout, CancellationToken cancellationToken = default);
    }

    public interface IServerProcessFactory
    {
        IServerProcess Create(ServerLaunchOptions options);
    }

    public sealed class SystemServerProcessFactory : IServerProcessFactory
    {
        public IServerProcess Create(ServerLaunchOptions options)
        {
            if (!string.IsNullOrWhiteSpace(options.ControlToken) &&
                (!IsHex(options.ControlToken, 64) ||
                 options.OwnerProcessId <= 0 ||
                 options.OwnerProcessStartTimeUtcFileTime <= 0 ||
                 string.IsNullOrWhiteSpace(options.ControlInstanceId)))
            {
                throw new ArgumentException(
                    "Authenticated server ownership launch metadata is incomplete.",
                    nameof(options));
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = options.ExecutablePath,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = System.IO.Path.GetDirectoryName(options.ExecutablePath) ?? ""
            };
            startInfo.ArgumentList.Add("--https-port");
            startInfo.ArgumentList.Add(options.Port.ToString(CultureInfo.InvariantCulture));
            startInfo.ArgumentList.Add("--http-port");
            startInfo.ArgumentList.Add(options.HttpPort.ToString(CultureInfo.InvariantCulture));
            startInfo.ArgumentList.Add("--environment");
            startInfo.ArgumentList.Add(options.EnvironmentName);
            if (!string.IsNullOrWhiteSpace(options.DataRootDirectory))
            {
                startInfo.ArgumentList.Add("--data-root");
                startInfo.ArgumentList.Add(options.DataRootDirectory);
            }
            if (options.AllowInsecureHttp)
            {
                startInfo.ArgumentList.Add("--allow-insecure-http");
            }
            if (!string.IsNullOrWhiteSpace(options.TlsStorageDirectory))
            {
                startInfo.ArgumentList.Add("--tls-storage-dir");
                startInfo.ArgumentList.Add(options.TlsStorageDirectory);
            }
            if (!string.IsNullOrWhiteSpace(options.ControlToken))
            {
                startInfo.RedirectStandardInput = true;
                startInfo.ArgumentList.Add("--control-token-stdin");
                startInfo.ArgumentList.Add("--owner-process-id");
                startInfo.ArgumentList.Add(
                    options.OwnerProcessId.ToString(CultureInfo.InvariantCulture));
                startInfo.ArgumentList.Add("--owner-process-start-time");
                startInfo.ArgumentList.Add(
                    options.OwnerProcessStartTimeUtcFileTime.ToString(
                        CultureInfo.InvariantCulture));
                startInfo.ArgumentList.Add("--control-instance-id");
                startInfo.ArgumentList.Add(options.ControlInstanceId ?? "");
            }
            startInfo.ArgumentList.Add("--upload-dir");
            startInfo.ArgumentList.Add(options.UploadDirectory);
            startInfo.ArgumentList.Add("--filename-conflict");
            startInfo.ArgumentList.Add(
                options.FilenameConflictPolicy == FilenameConflictPolicy.Reject
                    ? "reject"
                    : "keep-both");

            return new SystemServerProcess(
                new Process { StartInfo = startInfo },
                captureOutput: true,
                options.ControlToken);
        }

        private static bool IsHex(string value, int expectedLength)
        {
            if (value.Length != expectedLength) return false;
            foreach (char character in value)
            {
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f') ||
                      (character >= 'A' && character <= 'F')))
                {
                    return false;
                }
            }
            return true;
        }
    }

    internal sealed class SystemServerProcess : IServerProcess
    {
        private readonly Process _process;
        private readonly bool _captureOutput;
        private string? _controlToken;
        private SafeFileHandle? _lifetimeJob;

        public SystemServerProcess(
            Process process,
            bool captureOutput,
            string? controlToken = null)
        {
            _process = process;
            _captureOutput = captureOutput;
            _controlToken = controlToken;
        }

        public event Action<string>? OutputReceived;
        public event Action<string>? ErrorReceived;

        public int Id => _process.Id;
        public long StartTimeUtcFileTime =>
            _process.StartTime.ToUniversalTime().ToFileTimeUtc();
        public bool HasExited => _process.HasExited;
        public int ExitCode => _process.ExitCode;
        internal ProcessStartInfo StartInfo => _process.StartInfo;

        public void Start()
        {
            if (_captureOutput)
            {
                _process.OutputDataReceived += OnOutputDataReceived;
                _process.ErrorDataReceived += OnErrorDataReceived;
            }

            _process.Start();

            if (_captureOutput)
            {
                try
                {
                    _lifetimeJob = ProcessLifetimeJob.CreateFor(_process);
                }
                catch
                {
                    try
                    {
                        if (!_process.HasExited)
                        {
                            _process.Kill(entireProcessTree: true);
                        }
                    }
                    catch
                    {
                        // Preserve the job-assignment failure as the launch error.
                    }
                    throw;
                }

                _process.BeginOutputReadLine();
                _process.BeginErrorReadLine();
            }

            if (!string.IsNullOrWhiteSpace(_controlToken))
            {
                _process.StandardInput.WriteLine(_controlToken);
                _process.StandardInput.Flush();
                _process.StandardInput.Close();
                _controlToken = null;
            }
        }

        public void Kill()
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
            }
        }

        public async Task<bool> WaitForExitAsync(
            TimeSpan timeout,
            CancellationToken cancellationToken = default)
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(timeout);
            try
            {
                await _process.WaitForExitAsync(timeoutCts.Token);
                return true;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return _process.HasExited;
            }
        }

        public void Dispose()
        {
            if (_captureOutput)
            {
                _process.OutputDataReceived -= OnOutputDataReceived;
                _process.ErrorDataReceived -= OnErrorDataReceived;
            }

            _lifetimeJob?.Dispose();
            _lifetimeJob = null;
            _process.Dispose();
        }

        private void OnOutputDataReceived(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null)
            {
                OutputReceived?.Invoke(e.Data);
            }
        }

        private void OnErrorDataReceived(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null)
            {
                ErrorReceived?.Invoke(e.Data);
            }
        }
    }

    internal static class ProcessLifetimeJob
    {
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private const int JobObjectExtendedLimitInformationClass = 9;

        public static SafeFileHandle CreateFor(Process process)
        {
            if (!OperatingSystem.IsWindows())
            {
                throw new PlatformNotSupportedException(
                    "Owned server lifetime jobs require Windows.");
            }

            var job = CreateJobObject(IntPtr.Zero, null);
            if (job.IsInvalid)
            {
                throw new System.ComponentModel.Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not create the owned-server job object.");
            }

            try
            {
                var limits = new JobObjectExtendedLimitInformation();
                limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
                int length = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
                IntPtr buffer = Marshal.AllocHGlobal(length);
                try
                {
                    Marshal.StructureToPtr(limits, buffer, false);
                    if (!SetInformationJobObject(
                            job,
                            JobObjectExtendedLimitInformationClass,
                            buffer,
                            (uint)length))
                    {
                        throw new System.ComponentModel.Win32Exception(
                            Marshal.GetLastWin32Error(),
                            "Could not configure the owned-server job object.");
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }

                if (!AssignProcessToJobObject(job, process.SafeHandle))
                {
                    throw new System.ComponentModel.Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "Could not attach the owned server to its lifetime job.");
                }

                return job;
            }
            catch
            {
                job.Dispose();
                throw;
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectBasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectExtendedLimitInformation
        {
            public JobObjectBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateJobObject(
            IntPtr jobAttributes,
            string? name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(
            SafeFileHandle job,
            int jobObjectInformationClass,
            IntPtr jobObjectInformation,
            uint jobObjectInformationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(
            SafeFileHandle job,
            SafeProcessHandle process);
    }
}
