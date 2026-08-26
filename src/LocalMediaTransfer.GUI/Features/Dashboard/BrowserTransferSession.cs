using System;

namespace LocalMediaTransfer.GUI.Features.Dashboard
{
    public static class BrowserTransferSession
    {
        public const int LifetimeSeconds = 5 * 60;

        public static int RemainingSeconds(
            DateTimeOffset expiresAtUtc,
            DateTimeOffset nowUtc)
        {
            double seconds = (expiresAtUtc - nowUtc).TotalSeconds;
            return seconds <= 0 ? 0 : (int)Math.Ceiling(seconds);
        }

        public static string FormatRemaining(int seconds)
        {
            int bounded = Math.Clamp(seconds, 0, LifetimeSeconds);
            return $"{bounded / 60}:{bounded % 60:D2}";
        }
    }
}
