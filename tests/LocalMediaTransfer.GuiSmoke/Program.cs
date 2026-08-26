using System.Diagnostics;
using System.Runtime.InteropServices;

return await GuiSmoke.RunAsync(args);

internal static class GuiSmoke
{
    private const uint WmClose = 0x0010;

    public static async Task<int> RunAsync(string[] args)
    {
        bool trayLifecycle = args.Contains(
            "--tray-lifecycle",
            StringComparer.OrdinalIgnoreCase);
        bool production = args.Contains(
            "--production",
            StringComparer.OrdinalIgnoreCase);
        string repoRoot = FindRepoRoot();
        string executable = Path.Combine(
            repoRoot,
            "src",
            "LocalMediaTransfer.GUI",
            "bin",
            "x64",
            production ? "Debug" : "Debug-Test",
            "net8.0-windows10.0.19041.0",
            production ? "LocalMediaTransfer.GUI.exe" :
                "LocalMediaTransfer.GUI.Test.exe");

        if (!File.Exists(executable))
        {
            Console.Error.WriteLine(
                $"GUI executable not found: {executable}{Environment.NewLine}" +
                $"Build the Debug x64 {(production ? "production" : "TEST")} application before running the smoke test.");
            return 2;
        }

        if (FindProcesses("LocalMediaTransfer.GUI").Count > 0 ||
            FindProcesses("LocalMediaTransfer.GUI.Test").Count > 0 ||
            FindProcesses("LocalMediaTransferServer").Count > 0)
        {
            Console.Error.WriteLine(
                "Refusing to run while a GUI or server process already exists. " +
                "Close it normally and retry.");
            return 2;
        }

        Process? gui = null;
        var observedServerIds = new HashSet<int>();
        string? runtimeRoot = production ? null : CreateIsolatedRuntimeRoot();
        string settingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LocalMediaTransfer", "gui-settings.json");
        byte[]? originalSettings = production && File.Exists(settingsPath)
            ? File.ReadAllBytes(settingsPath) : null;
        bool settingsExisted = production && File.Exists(settingsPath);
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = Path.GetDirectoryName(executable)!,
                UseShellExecute = false
            };
            if (!production) startInfo.Environment["LMT_TEST_DATA_ROOT"] = runtimeRoot!;
            if (trayLifecycle)
            {
                startInfo.Environment["LMT_FORCE_MINIMIZE_TO_TRAY"] = "1";
                startInfo.Environment["LMT_SMOKE_TRAY_EXIT_DELAY_MS"] = "5000";
            }
            else
            {
                // Debug-style close behavior lets WM_CLOSE terminate the app.
                startInfo.Environment["VisualStudioVersion"] = "SmokeTest";
            }

            gui = Process.Start(startInfo) ??
                  throw new InvalidOperationException("Failed to start the GUI.");
            Console.WriteLine($"Started GUI process {gui.Id}.");

            await Task.Delay(TimeSpan.FromSeconds(3));
            if (gui.HasExited)
            {
                throw new InvalidOperationException(
                    $"GUI exited immediately with code {gui.ExitCode}.");
            }

            IntPtr window = await WaitForWindowAsync(gui.Id, TimeSpan.FromSeconds(10));
            Console.WriteLine("WinUI window activated.");

            Process server = await WaitForSingleProcessAsync(
                "LocalMediaTransferServer",
                TimeSpan.FromSeconds(15));
            observedServerIds.Add(server.Id);
            server.Dispose();
            Console.WriteLine("Owned server started.");

            if (!production)
            {
                await WaitForAuthenticatedSecuritySyncAsync(
                    runtimeRoot!, TimeSpan.FromSeconds(10));
                Console.WriteLine("Authenticated GUI security-state sync observed.");
            }

            if (!PostMessage(window, WmClose, IntPtr.Zero, IntPtr.Zero))
            {
                throw new InvalidOperationException(
                    $"Unable to send WM_CLOSE. Win32 error: {Marshal.GetLastWin32Error()}");
            }

            if (trayLifecycle)
            {
                await Task.Delay(750);
                if (gui.HasExited)
                {
                    throw new InvalidOperationException(
                        "Release GUI exited instead of hiding to the tray.");
                }

                if (FindVisibleWindow(gui.Id) != IntPtr.Zero)
                {
                    throw new InvalidOperationException(
                        "Release GUI window remained visible after WM_CLOSE.");
                }
                Console.WriteLine("TEST GUI hid to the tray.");
            }

            await gui.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15));
            Console.WriteLine(
                trayLifecycle
                    ? "Tray Exit command closed the GUI."
                    : "GUI closed.");

            await WaitForNoProcessAsync(
                "LocalMediaTransferServer",
                observedServerIds,
                TimeSpan.FromSeconds(10));
            Console.WriteLine("Owned server closed with the GUI.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"GUI smoke test failed: {ex.Message}");
            return 1;
        }
        finally
        {
            if (gui is not null)
            {
                try
                {
                    if (!gui.HasExited)
                    {
                        gui.Kill(entireProcessTree: true);
                        await gui.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
                    }
                }
                catch
                {
                }
                gui.Dispose();
            }

            foreach (int processId in observedServerIds)
            {
                try
                {
                    using Process process = Process.GetProcessById(processId);
                    if (!process.HasExited)
                    {
                        process.Kill(entireProcessTree: true);
                        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
                    }
                }
                catch (ArgumentException)
                {
                }
                catch
                {
                }
            }

            if (runtimeRoot is not null)
                await DeleteIsolatedRuntimeRootAsync(runtimeRoot);
            if (production)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
                if (settingsExisted) File.WriteAllBytes(settingsPath, originalSettings!);
                else if (File.Exists(settingsPath)) File.Delete(settingsPath);
                Console.WriteLine("Production GUI settings restored.");
            }
        }
    }

    private static async Task WaitForAuthenticatedSecuritySyncAsync(
        string runtimeRoot,
        TimeSpan timeout)
    {
        string marker = Path.Combine(
            runtimeRoot,
            "authenticated-security-sync.ok");
        DateTime deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (File.Exists(marker))
            {
                return;
            }

            await Task.Delay(150);
        }

        throw new InvalidOperationException(
            "The GUI did not complete authenticated token and security-policy synchronization.");
    }

    private static string CreateIsolatedRuntimeRoot()
    {
        string allowedRoot = Path.GetFullPath(Path.Combine(
            Path.GetTempPath(),
            "LocalMediaTransfer.Tests"));
        string runtimeRoot = Path.Combine(allowedRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtimeRoot);
        return runtimeRoot;
    }

    private static async Task DeleteIsolatedRuntimeRootAsync(string runtimeRoot)
    {
        string allowedRoot = Path.GetFullPath(Path.Combine(
            Path.GetTempPath(),
            "LocalMediaTransfer.Tests"));
        string candidate = Path.GetFullPath(runtimeRoot);
        string allowedPrefix = allowedRoot.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(allowedPrefix, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(candidate, allowedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Refusing to clean a GUI smoke path outside the isolated test root.");
        }

        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                if (Directory.Exists(candidate))
                {
                    Directory.Delete(candidate, recursive: true);
                }
                return;
            }
            catch (IOException) when (attempt < 4)
            {
                await Task.Delay(150 * (attempt + 1));
            }
            catch (UnauthorizedAccessException) when (attempt < 4)
            {
                await Task.Delay(150 * (attempt + 1));
            }
        }
    }

    private static async Task<Process> WaitForSingleProcessAsync(
        string processName,
        TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            List<Process> processes = FindProcesses(processName);
            if (processes.Count == 1)
            {
                return processes[0];
            }

            foreach (Process process in processes)
            {
                process.Dispose();
            }
            await Task.Delay(150);
        }

        throw new TimeoutException(
            $"Expected one {processName} process within {timeout.TotalSeconds:0} seconds.");
    }

    private static async Task WaitForNoProcessAsync(
        string processName,
        IReadOnlySet<int> expectedProcessIds,
        TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            List<Process> processes = FindProcesses(processName);
            try
            {
                if (processes.All(process => !expectedProcessIds.Contains(process.Id)))
                {
                    return;
                }
            }
            finally
            {
                foreach (Process process in processes)
                {
                    process.Dispose();
                }
            }
            await Task.Delay(150);
        }

        throw new TimeoutException($"{processName} remained after the GUI closed.");
    }

    private static async Task<IntPtr> WaitForWindowAsync(int processId, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            IntPtr found = FindVisibleWindow(processId);

            if (found != IntPtr.Zero)
            {
                return found;
            }
            await Task.Delay(100);
        }

        throw new TimeoutException("WinUI window was not found for the GUI process.");
    }

    private static IntPtr FindVisibleWindow(int processId)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, _) =>
        {
            GetWindowThreadProcessId(window, out uint ownerProcessId);
            if (ownerProcessId == processId && IsWindowVisible(window))
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static List<Process> FindProcesses(string processName) =>
        Process.GetProcessesByName(processName).ToList();

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "src", "Server")) &&
                Directory.Exists(Path.Combine(current.FullName, "src", "LocalMediaTransfer.GUI")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("Repository root was not found.");
    }

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr window,
        out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(
        IntPtr window,
        uint message,
        IntPtr wParam,
        IntPtr lParam);
}
