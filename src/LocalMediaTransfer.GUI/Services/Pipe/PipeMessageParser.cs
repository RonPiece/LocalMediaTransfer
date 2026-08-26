using System;
using System.Collections.Generic;
using System.Text.Json;

namespace LocalMediaTransfer.GUI.Services
{
    internal enum PipeMessageKind
    {
        Metrics,
        Log,
        TransferHistory,
        PairingRequest,
        NativePairingRequest,
        NativeTransferRequest,
        TrustedDevices,
        CommandResult
    }

    internal sealed record PipeMessage(PipeMessageKind Kind, object? Payload);

    internal readonly record struct PipeParseResult(
        bool Success,
        PipeMessage? Message,
        string? Diagnostic)
    {
        public static PipeParseResult Parsed(PipeMessage message) => new(true, message, null);
        public static PipeParseResult Ignored(string diagnostic) => new(false, null, diagnostic);
    }

    internal static class PipeMessageParser
    {
        public static PipeParseResult Parse(string json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var type = root.GetProperty("type").GetString();
                var data = root.GetProperty("data");

                return type switch
                {
                    "metrics" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.Metrics,
                        new MetricsData
                        {
                            SpeedMBps = PipeValueValidator.NonNegativeFinite(
                                data.GetProperty("speedMBps").GetDouble(),
                                1_000_000,
                                "speedMBps"),
                            SpeedAvailable = !data.TryGetProperty("speedAvailable", out JsonElement available) || available.GetBoolean(),
                            FilesTransferred = PipeValueValidator.NonNegativeInt(
                                data.GetProperty("filesTransferred").GetInt32(),
                                10_000_000,
                                "filesTransferred"),
                            TotalBytes = PipeValueValidator.NonNegativeLong(
                                data.GetProperty("totalBytes").GetInt64(),
                                long.MaxValue,
                                "totalBytes"),
                            DurationSeconds = PipeValueValidator.NonNegativeLong(
                                data.GetProperty("durationSeconds").GetInt64(),
                                315_576_000,
                                "durationSeconds"),
                            IsActive = data.GetProperty("isActive").GetBoolean()
                        })),
                    "log" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.Log,
                        new LogData
                        {
                            Level = PipeValueValidator.DisplayText(
                                data.GetProperty("level").GetString() ?? "INFO",
                                16),
                            Message = PipeValueValidator.DisplayText(
                                data.GetProperty("message").GetString() ?? "",
                                PipeValueValidator.MaxLogMessageLength),
                            Timestamp = data.GetProperty("timestamp").GetInt64()
                        })),
                    "transfer_history" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.TransferHistory,
                        ParseTransferHistory(data))),
                    "pairing_request" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.PairingRequest,
                        new PairingRequestData
                        {
                            DeviceId = PipeValueValidator.Identifier(
                                data.GetProperty("deviceId").GetString() ?? "",
                                128,
                                "deviceId"),
                            DeviceName = PipeValueValidator.DisplayText(
                                data.GetProperty("deviceName").GetString() ?? "iPhone",
                                100),
                            IpAddress = PipeValueValidator.DisplayText(
                                data.GetProperty("ip").GetString() ?? "",
                                64)
                        })),
                    "native_pairing_request" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.NativePairingRequest,
                        new NativePairingRequestData
                        {
                            RequestId = PipeValueValidator.Identifier(
                                data.GetProperty("requestId").GetString() ?? "", 64, "requestId"),
                            DeviceId = PipeValueValidator.Identifier(
                                data.GetProperty("deviceId").GetString() ?? "", 128, "deviceId"),
                            DeviceName = PipeValueValidator.DisplayText(
                                data.GetProperty("deviceName").GetString() ?? "Windows computer", 100),
                            IpAddress = PipeValueValidator.DisplayText(
                                data.GetProperty("ip").GetString() ?? "", 64),
                            SecurityCode = PipeValueValidator.DisplayText(
                                data.GetProperty("securityCode").GetString() ?? "", 16)
                        })),
                    "native_transfer_request" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.NativeTransferRequest,
                        ParseNativeTransferRequest(data))),
                    "trusted_devices" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.TrustedDevices,
                        ParseTrustedDevices(data))),
                    "command_result" => PipeParseResult.Parsed(new PipeMessage(
                        PipeMessageKind.CommandResult,
                        new CommandResultData
                        {
                            RequestId = PipeValueValidator.Identifier(
                                data.GetProperty("requestId").GetString() ?? "",
                                64,
                                "requestId"),
                            Success = data.GetProperty("success").GetBoolean(),
                            Error = data.TryGetProperty("error", out JsonElement error)
                                ? PipeValueValidator.DisplayText(
                                    error.GetString() ?? "",
                                    256)
                                : ""
                        })),
                    _ => PipeParseResult.Ignored($"PipeClient ignored unknown message type '{type ?? "<missing>"}'")
                };
            }
            catch (JsonException)
            {
                return PipeParseResult.Ignored("PipeClient received malformed JSON message");
            }
            catch (Exception ex)
            {
                return PipeParseResult.Ignored($"PipeClient failed to process message: {ex.Message}");
            }
        }

        private static IReadOnlyList<TransferHistoryData> ParseTransferHistory(JsonElement data)
        {
            var history = new List<TransferHistoryData>();
            foreach (var item in data.EnumerateArray())
            {
                if (history.Count >= PipeValueValidator.MaxTransferHistoryEntries)
                {
                    throw new JsonException("Transfer history exceeds the GUI limit.");
                }
                history.Add(new TransferHistoryData
                {
                    SessionId = PipeValueValidator.Identifier(
                        item.GetProperty("sessionId").GetString() ?? "",
                        128,
                        "sessionId"),
                    CompletedAt = PipeValueValidator.UnixMilliseconds(
                        item.GetProperty("completedAt").GetInt64(),
                        "completedAt"),
                    SelectedFiles = PipeValueValidator.NonNegativeInt(item.GetProperty("selectedFiles").GetInt32(), 1_000_000, "selectedFiles"),
                    UploadedFiles = PipeValueValidator.NonNegativeInt(item.GetProperty("uploadedFiles").GetInt32(), 1_000_000, "uploadedFiles"),
                    SkippedFiles = PipeValueValidator.NonNegativeInt(item.GetProperty("skippedFiles").GetInt32(), 1_000_000, "skippedFiles"),
                    FailedFiles = PipeValueValidator.NonNegativeInt(item.GetProperty("failedFiles").GetInt32(), 1_000_000, "failedFiles"),
                    SelectedBytes = PipeValueValidator.NonNegativeLong(item.GetProperty("selectedBytes").GetInt64(), long.MaxValue, "selectedBytes"),
                    SelectedMediaBytes = PipeValueValidator.NonNegativeLong(
                        item.TryGetProperty("selectedMediaBytes", out JsonElement selectedMediaBytes)
                            ? selectedMediaBytes.GetInt64()
                            : item.GetProperty("selectedBytes").GetInt64(),
                        long.MaxValue,
                        "selectedMediaBytes"),
                    AdditionalComponentsBytes = PipeValueValidator.NonNegativeLong(
                        item.TryGetProperty("additionalComponentsBytes", out JsonElement additionalBytes)
                            ? additionalBytes.GetInt64()
                            : 0,
                        long.MaxValue,
                        "additionalComponentsBytes"),
                    SelectedMediaFiles = PipeValueValidator.NonNegativeInt(
                        item.TryGetProperty("selectedMediaFiles", out JsonElement selectedMediaFiles)
                            ? selectedMediaFiles.GetInt32()
                            : item.GetProperty("selectedFiles").GetInt32(),
                        1_000_000,
                        "selectedMediaFiles"),
                    AdditionalComponentsFiles = PipeValueValidator.NonNegativeInt(
                        item.TryGetProperty("additionalComponentsFiles", out JsonElement additionalFiles)
                            ? additionalFiles.GetInt32()
                            : 0,
                        1_000_000,
                        "additionalComponentsFiles"),
                    UploadedBytes = PipeValueValidator.NonNegativeLong(item.GetProperty("uploadedBytes").GetInt64(), long.MaxValue, "uploadedBytes"),
                    SkippedBytes = PipeValueValidator.NonNegativeLong(item.GetProperty("skippedBytes").GetInt64(), long.MaxValue, "skippedBytes"),
                    TotalDurationMs = PipeValueValidator.NonNegativeLong(item.GetProperty("totalDurationMs").GetInt64(), 315_576_000_000, "totalDurationMs"),
                    AverageSpeedMBps = PipeValueValidator.NonNegativeFinite(item.GetProperty("averageSpeedMBps").GetDouble(), 1_000_000, "averageSpeedMBps"),
                    PeakSpeedMBps = PipeValueValidator.NonNegativeFinite(item.GetProperty("peakSpeedMBps").GetDouble(), 1_000_000, "peakSpeedMBps")
                });
            }

            return history;
        }

        private static NativeTransferRequestData ParseNativeTransferRequest(JsonElement data)
        {
            var names = new List<string>();
            foreach (JsonElement name in data.GetProperty("sampleNames").EnumerateArray())
            {
                if (names.Count >= 5) throw new JsonException("Too many transfer sample names.");
                names.Add(PipeValueValidator.DisplayText(name.GetString() ?? "", 200));
            }
            return new NativeTransferRequestData
            {
                RequestId = PipeValueValidator.Identifier(
                    data.GetProperty("requestId").GetString() ?? "", 64, "requestId"),
                DeviceId = PipeValueValidator.Identifier(
                    data.GetProperty("deviceId").GetString() ?? "", 128, "deviceId"),
                DeviceName = PipeValueValidator.DisplayText(
                    data.GetProperty("deviceName").GetString() ?? "Windows computer", 100),
                IpAddress = PipeValueValidator.DisplayText(
                    data.GetProperty("ip").GetString() ?? "", 64),
                FileCount = PipeValueValidator.NonNegativeInt(
                    data.GetProperty("fileCount").GetInt32(), 1000, "fileCount"),
                TotalBytes = PipeValueValidator.NonNegativeLong(
                    data.GetProperty("totalBytes").GetInt64(), long.MaxValue, "totalBytes"),
                SampleNames = names
            };
        }

        private static IReadOnlyList<TrustedDeviceData> ParseTrustedDevices(JsonElement data)
        {
            var devices = new List<TrustedDeviceData>();
            foreach (var item in data.EnumerateArray())
            {
                if (devices.Count >= PipeValueValidator.MaxTrustedDevices)
                {
                    throw new JsonException("Trusted-device data exceeds the GUI limit.");
                }
                devices.Add(new TrustedDeviceData
                {
                    DeviceId = PipeValueValidator.Identifier(item.GetProperty("id").GetString() ?? "", 128, "id"),
                    DeviceName = PipeValueValidator.DisplayText(item.GetProperty("name").GetString() ?? "iPhone", 100),
                    LastIp = PipeValueValidator.DisplayText(item.GetProperty("lastIp").GetString() ?? "", 64),
                    LastSeenUnix = PipeValueValidator.OptionalUnixSeconds(item.GetProperty("lastSeenUnix").GetInt64(), "lastSeenUnix")
                    ,ClientType = item.TryGetProperty("clientType", out JsonElement clientType)
                        ? PipeValueValidator.Identifier(clientType.GetString() ?? "ios", 32, "clientType") : "ios"
                    ,AuthorizationMode = item.TryGetProperty("authorizationMode", out JsonElement mode)
                        ? PipeValueValidator.Identifier(mode.GetString() ?? "direct_upload", 32, "authorizationMode") : "direct_upload"
                });
            }

            return devices;
        }
    }
}
