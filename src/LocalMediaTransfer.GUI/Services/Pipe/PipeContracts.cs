using System;
using System.Collections.Generic;

namespace LocalMediaTransfer.GUI.Services
{
    public readonly record struct PipeCommandAcknowledgement(
        bool Success,
        string Error)
    {
        public static PipeCommandAcknowledgement Ok() => new(true, "");
        public static PipeCommandAcknowledgement Failed(string error) =>
            new(false, string.IsNullOrWhiteSpace(error) ? "Command failed." : error);
    }

    internal sealed class CommandResultData
    {
        public string RequestId { get; set; } = "";
        public bool Success { get; set; }
        public string Error { get; set; } = "";
    }

    public sealed class PairingRequestData
    {
        public string DeviceId { get; set; } = "";
        public string DeviceName { get; set; } = "";
        public string IpAddress { get; set; } = "";
    }

    public sealed class NativePairingRequestData
    {
        public string RequestId { get; set; } = "";
        public string DeviceId { get; set; } = "";
        public string DeviceName { get; set; } = "";
        public string IpAddress { get; set; } = "";
        public string SecurityCode { get; set; } = "";
    }

    public sealed class NativeTransferRequestData
    {
        public string RequestId { get; set; } = "";
        public string DeviceId { get; set; } = "";
        public string DeviceName { get; set; } = "";
        public string IpAddress { get; set; } = "";
        public int FileCount { get; set; }
        public long TotalBytes { get; set; }
        public IReadOnlyList<string> SampleNames { get; set; } = Array.Empty<string>();
    }

    public sealed class TrustedDeviceData
    {
        public string DeviceId { get; set; } = "";
        public string DeviceName { get; set; } = "";
        public string LastIp { get; set; } = "";
        public long LastSeenUnix { get; set; }
        public string ClientType { get; set; } = "ios";
        public string AuthorizationMode { get; set; } = "direct_upload";
        public string DeviceTypeText => ClientType == "windows"
            ? "Windows computer · approval required for every transfer"
            : "iPhone · direct upload credential";
        public string LastSeenText => LastSeenUnix > 0
            ? $"Last connected {DateTimeOffset.FromUnixTimeSeconds(LastSeenUnix).ToLocalTime():g}"
            : "Not connected yet";
    }

    /// <summary>Real-time metrics from the C++ server.</summary>
    public sealed class MetricsData
    {
        public double SpeedMBps { get; set; }
        public bool SpeedAvailable { get; set; }
        public int FilesTransferred { get; set; }
        public long TotalBytes { get; set; }
        public long DurationSeconds { get; set; }
        public bool IsActive { get; set; }
    }

    /// <summary>Log entry from the C++ server.</summary>
    public sealed class LogData
    {
        public string Level { get; set; } = "";
        public string Message { get; set; } = "";
        public long Timestamp { get; set; }
    }

    public sealed class TransferHistoryData
    {
        public string SessionId { get; set; } = "";
        public long CompletedAt { get; set; }
        public int SelectedFiles { get; set; }
        public int UploadedFiles { get; set; }
        public int SkippedFiles { get; set; }
        public int FailedFiles { get; set; }
        public long SelectedBytes { get; set; }
        public long SelectedMediaBytes { get; set; }
        public long AdditionalComponentsBytes { get; set; }
        public int SelectedMediaFiles { get; set; }
        public int AdditionalComponentsFiles { get; set; }
        public long UploadedBytes { get; set; }
        public long SkippedBytes { get; set; }
        public long TotalDurationMs { get; set; }
        public double AverageSpeedMBps { get; set; }
        public double PeakSpeedMBps { get; set; }
    }
}
