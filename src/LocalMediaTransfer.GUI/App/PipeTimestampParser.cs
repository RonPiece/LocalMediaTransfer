using System;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class PipeTimestampParser
    {
        public static DateTimeOffset Parse(long timestamp)
        {
            if (timestamp <= 0)
            {
                return DateTimeOffset.Now;
            }

            if (TryParseUnixTimestamp(timestamp, tryMilliseconds: true, out var parsed) ||
                TryParseUnixTimestamp(timestamp, tryMilliseconds: false, out parsed))
            {
                return parsed.ToLocalTime();
            }

            return DateTimeOffset.Now;
        }

        private static bool TryParseUnixTimestamp(long value, bool tryMilliseconds, out DateTimeOffset timestamp)
        {
            try
            {
                timestamp = tryMilliseconds
                    ? DateTimeOffset.FromUnixTimeMilliseconds(value)
                    : DateTimeOffset.FromUnixTimeSeconds(value);

                var now = DateTimeOffset.UtcNow;
                return timestamp >= now.AddYears(-20) && timestamp <= now.AddDays(2);
            }
            catch (ArgumentOutOfRangeException)
            {
                timestamp = default;
                return false;
            }
        }
    }
}
