using System;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class ServerLogClassifier
    {
        public static bool IsImportant(string log)
        {
            return log.Contains("Starting", StringComparison.OrdinalIgnoreCase) ||
                   log.Contains("Port:", StringComparison.OrdinalIgnoreCase) ||
                   log.Contains("connected", StringComparison.OrdinalIgnoreCase) ||
                   log.Contains("Exception", StringComparison.OrdinalIgnoreCase) ||
                   log.Contains("failed", StringComparison.OrdinalIgnoreCase);
        }
    }
}
