using System;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class AppLifecycleService
    {
        public static bool TryGetSmokeExitDelay(out int delayMs)
        {
            var rawDelay = Environment.GetEnvironmentVariable("LMT_SMOKE_TRAY_EXIT_DELAY_MS");
            if (int.TryParse(rawDelay, out delayMs) &&
                delayMs >= 500 &&
                delayMs <= 60000)
            {
                return true;
            }

            delayMs = 0;
            return false;
        }

        public static async Task RunDelayedAsync(int delayMs, Func<Task> action)
        {
            await Task.Delay(delayMs);
            await action();
        }
    }
}
