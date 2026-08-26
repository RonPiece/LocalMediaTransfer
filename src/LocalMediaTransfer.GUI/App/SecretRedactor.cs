using System;
using System.Text.RegularExpressions;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class SecretRedactor
    {
        private static readonly TimeSpan MatchTimeout = TimeSpan.FromMilliseconds(100);
        private static readonly Regex QuerySecret = new(
            @"([?&](?:token|credential|access_token|api_key)=)[^&\s\""']+",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            MatchTimeout);
        private static readonly Regex AssignedSecret = new(
            @"(\b(?:token|credential|authorization|api[_-]?key|private[_ -]?key)\b\s*[:=]\s*)(?:\""[^\""\r\n]*\""|'[^'\r\n]*'|[^\s,;]+)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            MatchTimeout);
        private static readonly Regex BearerSecret = new(
            @"(\bBearer\s+)[A-Za-z0-9._~+/=-]+",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            MatchTimeout);

        public static string Redact(string? value)
        {
            if (string.IsNullOrEmpty(value)) return value ?? "";
            try
            {
                string redacted = QuerySecret.Replace(value, "$1[redacted]");
                redacted = AssignedSecret.Replace(redacted, "$1[redacted]");
                return BearerSecret.Replace(redacted, "$1[redacted]");
            }
            catch (RegexMatchTimeoutException)
            {
                return "[diagnostic redacted after sanitizer timeout]";
            }
        }
    }
}
