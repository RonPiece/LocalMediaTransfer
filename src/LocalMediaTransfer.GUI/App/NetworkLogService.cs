using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using LocalMediaTransfer.GUI.Models;

namespace LocalMediaTransfer.GUI.AppServices
{
    public sealed class NetworkLogService
    {
        private const int MaxNetworkLogEntries = 300;
        private static readonly TimeSpan DuplicateLogWindow = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan ConnectionLogDuplicateWindow = TimeSpan.FromSeconds(12);

        private readonly Dictionary<string, DateTimeOffset> _lastNetworkLogByMessage =
            new(StringComparer.Ordinal);

        public ObservableCollection<LogEntry> Entries { get; } = new();

        public void Add(string message, DateTimeOffset? timestamp = null)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return;
            }

            var nowUtc = DateTimeOffset.UtcNow;
            var duplicateWindow = GetDuplicateWindowForMessage(message);
            if (_lastNetworkLogByMessage.TryGetValue(message, out var lastAddedUtc) &&
                nowUtc - lastAddedUtc < duplicateWindow)
            {
                return;
            }

            _lastNetworkLogByMessage[message] = nowUtc;
            var entryTimestamp = timestamp ?? DateTimeOffset.Now;

            Entries.Insert(0, new LogEntry
            {
                Time = entryTimestamp.ToLocalTime().ToString("HH:mm:ss"),
                Message = message
            });

            while (Entries.Count > MaxNetworkLogEntries)
            {
                Entries.RemoveAt(Entries.Count - 1);
            }

            PruneDeduplicationCache();
        }

        private static TimeSpan GetDuplicateWindowForMessage(string message)
        {
            return message.Contains("Lost connection to server", StringComparison.OrdinalIgnoreCase) ||
                   message.Contains("Connected to background Server", StringComparison.OrdinalIgnoreCase)
                ? ConnectionLogDuplicateWindow
                : DuplicateLogWindow;
        }

        private void PruneDeduplicationCache()
        {
            if (_lastNetworkLogByMessage.Count <= MaxNetworkLogEntries * 2)
            {
                return;
            }

            var cutoffUtc = DateTimeOffset.UtcNow - ConnectionLogDuplicateWindow;
            var expired = new List<string>();
            foreach (var item in _lastNetworkLogByMessage)
            {
                if (item.Value < cutoffUtc)
                {
                    expired.Add(item.Key);
                }
            }

            foreach (var key in expired)
            {
                _lastNetworkLogByMessage.Remove(key);
            }
        }
    }
}
