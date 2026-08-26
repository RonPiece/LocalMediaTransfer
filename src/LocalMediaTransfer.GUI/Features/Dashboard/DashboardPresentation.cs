using System;
using System.Collections.Generic;
using LocalMediaTransfer.GUI.Models;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.Features.Dashboard
{
    public static class DashboardPresentation
    {
        public static string FormatBytes(long bytes)
        {
            if (bytes >= 1024L * 1024 * 1024)
            {
                return $"{bytes / (1024.0 * 1024 * 1024):F2} GB";
            }

            return $"{bytes / (1024.0 * 1024):F1} MB";
        }

        public static IReadOnlyList<TransferHistoryItem> ToTransferItems(
            IReadOnlyList<TransferHistoryData> sessions)
        {
            var items = new List<TransferHistoryItem>(sessions.Count);
            foreach (var session in sessions)
            {
                var completed = DateTimeOffset.FromUnixTimeMilliseconds(
                    session.CompletedAt).ToLocalTime();
                string outcome = $"{session.UploadedFiles} uploaded · " +
                    $"{session.SkippedFiles} skipped · {session.FailedFiles} failed";
                long selectedMediaBytes = session.SelectedMediaBytes > 0 || session.SelectedBytes == 0
                    ? session.SelectedMediaBytes
                    : session.SelectedBytes;
                string additionalComponentLabel = session.AdditionalComponentsFiles == 1
                    ? "1 additional component"
                    : $"{session.AdditionalComponentsFiles} additional components";
                string contentBreakdown = session.AdditionalComponentsBytes > 0 ||
                    session.AdditionalComponentsFiles > 0
                    ? $"{FormatBytes(selectedMediaBytes)} selected media · " +
                      $"+{FormatBytes(session.AdditionalComponentsBytes)} in " +
                      $"{additionalComponentLabel} · " +
                      $"{FormatBytes(session.SelectedBytes)} total content"
                    : $"{FormatBytes(selectedMediaBytes)} selected media";

                items.Add(new TransferHistoryItem
                {
                    Title = session.SelectedFiles == 1 ? "1 file" : $"{session.SelectedFiles} files",
                    Outcome = outcome,
                    ContentBreakdown = contentBreakdown,
                    UploadedSize = FormatBytes(session.UploadedBytes),
                    AverageSpeed = $"Average {session.AverageSpeedMBps:F1} MB/s",
                    PeakSpeed = $"Peak {session.PeakSpeedMBps:F1} MB/s",
                    Time = completed.ToString("g")
                });
            }

            return items;
        }

        public static Dictionary<string, object?> BuildPairingPayload(
            string serverId,
            string machineName,
            string httpsUrl,
            string certificateFingerprint,
            string token,
            string runtimeEnvironment)
        {
            return new Dictionary<string, object?>
            {
                ["type"] = "lmt-pair",
                ["version"] = 3,
                ["environment"] = runtimeEnvironment,
                ["serverId"] = serverId,
                ["name"] = machineName,
                ["httpsUrl"] = httpsUrl,
                ["certificateFingerprint"] = certificateFingerprint,
                ["token"] = token
            };
        }
    }
}
