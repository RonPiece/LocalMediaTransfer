using System;
using LocalMediaTransfer.GUI.Models;
using Microsoft.UI.Xaml.Media;

namespace LocalMediaTransfer.GUI.Features.Security
{
    public static class ConnectionHistoryMapper
    {
        public static bool TryMap(LogEntry logEntry, out ConnectionEntry entry)
        {
            string message = logEntry.Message?.Trim() ?? string.Empty;

            if (message.Length == 0)
            {
                entry = default!;
                return false;
            }

            if (message.Contains("Device connected:", StringComparison.OrdinalIgnoreCase))
            {
                var ip = message[(message.IndexOf(':') + 1)..].Trim();
                entry = Create(logEntry.Time, "Device connected",
                    string.IsNullOrWhiteSpace(ip) ? "Remote device" : ip,
                    "\uE774", "SystemFillColorSuccessBrush");
                return true;
            }

            if (message.Contains("Save folder changed", StringComparison.OrdinalIgnoreCase))
            {
                entry = Create(logEntry.Time, "Save folder changed",
                    "Server restarted", "\uE777", "SystemFillColorCautionBrush");
                return true;
            }

            if (message.Contains("Port changed", StringComparison.OrdinalIgnoreCase))
            {
                entry = Create(logEntry.Time, "Port changed",
                    "Server restarted", "\uE777", "SystemFillColorCautionBrush");
                return true;
            }

            if (message.Contains("Server restarted", StringComparison.OrdinalIgnoreCase))
            {
                entry = Create(logEntry.Time, "Server restarted",
                    "Ready for uploads", "\uE777", "SystemFillColorCautionBrush");
                return true;
            }

            if (message.Contains("Connected to background Server", StringComparison.OrdinalIgnoreCase))
            {
                entry = Create(logEntry.Time, "GUI connected to server",
                    "Local pipe", "\uE774", "SystemFillColorSuccessBrush");
                return true;
            }

            if (message.Contains("Server stopped", StringComparison.OrdinalIgnoreCase))
            {
                entry = Create(logEntry.Time, "Server stopped",
                    "Uploads paused", "\uE711", "SystemFillColorCriticalBrush");
                return true;
            }

            if (message.Contains("Lost connection to server", StringComparison.OrdinalIgnoreCase))
            {
                entry = Create(logEntry.Time, "Server connection lost",
                    "Reconnecting", "\uE711", "SystemFillColorCriticalBrush");
                return true;
            }

            if (message.StartsWith("[Server Error]", StringComparison.OrdinalIgnoreCase))
            {
                entry = Create(logEntry.Time, "Server error",
                    message, "\uE783", "SystemFillColorCautionBrush");
                return true;
            }

            entry = default!;
            return false;
        }

        private static ConnectionEntry Create(
            string time,
            string deviceInfo,
            string ipAddress,
            string icon,
            string brushResourceKey)
        {
            return new ConnectionEntry
            {
                Time = time,
                DeviceInfo = deviceInfo,
                IpAddress = ipAddress,
                Icon = icon,
                IconColor = (Brush)Microsoft.UI.Xaml.Application.Current.Resources[brushResourceKey]
            };
        }
    }
}
