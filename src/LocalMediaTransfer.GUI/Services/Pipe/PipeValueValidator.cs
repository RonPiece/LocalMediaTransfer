using System;
using System.Text;
using System.Text.Json;

namespace LocalMediaTransfer.GUI.Services
{
    internal static class PipeValueValidator
    {
        public const int MaxTransferHistoryEntries = 120;
        public const int MaxTrustedDevices = 256;
        public const int MaxLogMessageLength = 16 * 1024;
        private static readonly long MinimumUnixSeconds =
            new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds();

        public static string Identifier(string value, int maxLength, string field)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > maxLength ||
                ContainsUnsafeCharacters(value))
            {
                throw new JsonException($"Pipe field '{field}' is invalid.");
            }
            return value;
        }

        public static string DisplayText(string value, int maxLength)
        {
            if (value.Length > maxLength)
            {
                value = value[..maxLength];
            }

            var output = new StringBuilder(value.Length);
            foreach (char character in value)
            {
                if (IsBidirectionalControl(character) || char.IsControl(character))
                {
                    output.Append('\uFFFD');
                }
                else
                {
                    output.Append(character);
                }
            }
            return output.ToString();
        }

        public static int NonNegativeInt(int value, int maximum, string field)
        {
            if (value < 0 || value > maximum)
            {
                throw new JsonException($"Pipe field '{field}' is out of range.");
            }
            return value;
        }

        public static long NonNegativeLong(long value, long maximum, string field)
        {
            if (value < 0 || value > maximum)
            {
                throw new JsonException($"Pipe field '{field}' is out of range.");
            }
            return value;
        }

        public static double NonNegativeFinite(
            double value,
            double maximum,
            string field)
        {
            if (!double.IsFinite(value) || value < 0 || value > maximum)
            {
                throw new JsonException($"Pipe field '{field}' is out of range.");
            }
            return value;
        }

        public static long UnixMilliseconds(long value, string field)
        {
            long minimum = MinimumUnixSeconds * 1000;
            long maximum = DateTimeOffset.UtcNow.AddDays(2).ToUnixTimeMilliseconds();
            if (value < minimum || value > maximum)
            {
                throw new JsonException($"Pipe timestamp '{field}' is out of range.");
            }
            return value;
        }

        public static long OptionalUnixSeconds(long value, string field)
        {
            if (value == 0) return 0;
            long maximum = DateTimeOffset.UtcNow.AddDays(2).ToUnixTimeSeconds();
            if (value < MinimumUnixSeconds || value > maximum)
            {
                throw new JsonException($"Pipe timestamp '{field}' is out of range.");
            }
            return value;
        }

        private static bool ContainsUnsafeCharacters(string value)
        {
            foreach (char character in value)
            {
                if (char.IsControl(character) || IsBidirectionalControl(character))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool IsBidirectionalControl(char value) =>
            value is >= '\u202A' and <= '\u202E' or >= '\u2066' and <= '\u2069';
    }
}
