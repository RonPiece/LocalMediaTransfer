using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace LocalMediaTransfer.Benchmarks;

internal static class MachineInfo
{
    public static MachineMetadata Collect(string storagePath)
    {
        NetworkInterface? nic = NetworkInterface.GetAllNetworkInterfaces()
            .Where(item => item.OperationalStatus == OperationalStatus.Up)
            .Where(item => item.NetworkInterfaceType is
                NetworkInterfaceType.Ethernet or NetworkInterfaceType.Wireless80211)
            .OrderByDescending(item => item.Speed)
            .FirstOrDefault();

        string cpuName = ReadCpuName();
        int physicalCores = ReadPhysicalCoreCount();
        int logicalCores = Environment.ProcessorCount;
        long ramBytes = ReadPhysicalMemory();
        string root = Path.GetPathRoot(Path.GetFullPath(storagePath)) ?? storagePath;
        var drive = new DriveInfo(root);
        string storageModel = ReadCimValue(
            "(Get-CimInstance Win32_DiskDrive | Select-Object -First 1 -ExpandProperty Model)",
            drive.IsReady ? drive.VolumeLabel : root);
        string storageType = drive.DriveType.ToString();
        string osName = RuntimeInformation.OSDescription;
        string osVersion = Environment.OSVersion.VersionString;
        string nicName = nic?.Description ?? "";
        double nicLinkMbps = (nic?.Speed ?? 0) / 1_000_000d;

        string fingerprintInput = string.Join(
            "|",
            Environment.MachineName,
            osName,
            cpuName,
            physicalCores,
            logicalCores,
            ramBytes,
            nicName,
            storageModel,
            storageType);
        string fingerprint = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(fingerprintInput))).ToLowerInvariant();

        return new(
            fingerprint,
            osName,
            osVersion,
            cpuName,
            physicalCores,
            logicalCores,
            ramBytes,
            nicName,
            nicLinkMbps,
            storageModel,
            storageType);
    }

    public static long ReadNetworkBytes()
    {
        return NetworkInterface.GetAllNetworkInterfaces()
            .Where(item => item.OperationalStatus == OperationalStatus.Up)
            .Sum(item =>
            {
                try
                {
                    IPv4InterfaceStatistics statistics = item.GetIPv4Statistics();
                    return statistics.BytesSent + statistics.BytesReceived;
                }
                catch
                {
                    return 0L;
                }
            });
    }

    public static (long ReadBytes, long WriteBytes) ReadProcessIo(Process process)
    {
        if (!OperatingSystem.IsWindows() ||
            !GetProcessIoCounters(process.Handle, out IoCounters counters))
        {
            return (0, 0);
        }
        return ((long)counters.ReadTransferCount, (long)counters.WriteTransferCount);
    }

    public static Process GetMetricsProcess()
    {
        try
        {
            Process? server = Process.GetProcessesByName("LocalMediaTransferServer")
                .OrderByDescending(process => process.StartTime)
                .FirstOrDefault();
            if (server != null) return server;
        }
        catch
        {
        }
        return Process.GetCurrentProcess();
    }

    private static string ReadCpuName()
    {
        if (!OperatingSystem.IsWindows())
            return RuntimeInformation.ProcessArchitecture.ToString();

        using RegistryKey? key = Registry.LocalMachine.OpenSubKey(
            @"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
        return key?.GetValue("ProcessorNameString")?.ToString()?.Trim() ??
               RuntimeInformation.ProcessArchitecture.ToString();
    }

    private static int ReadPhysicalCoreCount()
    {
        if (!OperatingSystem.IsWindows())
            return Environment.ProcessorCount;

        string value = ReadCimValue(
            "(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum",
            Environment.ProcessorCount.ToString());
        return int.TryParse(value, out int cores) && cores > 0
            ? cores
            : Environment.ProcessorCount;
    }

    private static string ReadCimValue(string command, string fallback)
    {
        if (!OperatingSystem.IsWindows()) return fallback;
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                ArgumentList =
                {
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    command
                },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            if (process == null)
                return fallback;
            Task<string> outputTask = process.StandardOutput.ReadToEndAsync();
            Task<string> errorTask = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(5000) || process.ExitCode != 0)
                return fallback;
            string value = outputTask.GetAwaiter().GetResult().Trim();
            _ = errorTask.GetAwaiter().GetResult();
            return string.IsNullOrWhiteSpace(value) ? fallback : value;
        }
        catch
        {
            return fallback;
        }
    }

    private static long ReadPhysicalMemory()
    {
        if (!OperatingSystem.IsWindows())
            return GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;

        var status = new MemoryStatusEx();
        return GlobalMemoryStatusEx(status) ? (long)status.TotalPhys : 0;
    }

    [StructLayout(LayoutKind.Sequential)]
    private sealed class MemoryStatusEx
    {
        public uint Length = (uint)Marshal.SizeOf<MemoryStatusEx>();
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
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

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatusEx buffer);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessIoCounters(IntPtr process, out IoCounters counters);
}
