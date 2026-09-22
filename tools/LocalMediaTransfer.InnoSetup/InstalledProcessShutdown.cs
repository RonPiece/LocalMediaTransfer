using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace LocalMediaTransfer.Installer
{
    // C# 5 compatible: loaded by Windows PowerShell during uninstall.
    public static class InstalledProcessShutdown
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern SafeProcessHandle OpenProcess(uint access, bool inherit, int id);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool QueryFullProcessImageName(SafeProcessHandle handle, uint flags, StringBuilder path, ref int size);
        [DllImport("kernel32.dll")]
        static extern uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateProcess(SafeProcessHandle handle, uint code);
        delegate bool WindowCallback(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")]
        static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")]
        static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        public static bool StopOne(int processId, string installedExecutable)
        {
            string expected = Path.GetFullPath(installedExecutable);
            using (SafeProcessHandle handle = OpenProcess(0x1000 | 0x100000 | 1, false, processId))
            {
                if (handle.IsInvalid) return false;
                var path = new StringBuilder(32768);
                int length = path.Capacity;
                if (!QueryFullProcessImageName(handle, 0, path, ref length) ||
                    !String.Equals(Path.GetFullPath(path.ToString()), expected, StringComparison.OrdinalIgnoreCase)) return false;
                if (WaitForSingleObject(handle, 0) == 0) return true;
                EnumWindows(delegate(IntPtr window, IntPtr unused) {
                    uint owner;
                    GetWindowThreadProcessId(window, out owner);
                    if (owner == processId && WaitForSingleObject(handle, 0) != 0)
                        PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
                    return true;
                }, IntPtr.Zero);
                if (WaitForSingleObject(handle, 5000) == 0) return true;
                // The retained kernel handle identifies the verified process,
                // even if its numeric PID is subsequently reused.
                return TerminateProcess(handle, 0) && WaitForSingleObject(handle, 5000) == 0;
            }
        }

        public static bool StopInstalled(string installedExecutable)
        {
            bool success = true;
            foreach (Process candidate in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(installedExecutable)))
            {
                using (candidate)
                {
                    // Nonmatching installations are deliberately untouched.
                    try {
                        var module = candidate.MainModule;
                        if (module != null && String.Equals(module.FileName, Path.GetFullPath(installedExecutable), StringComparison.OrdinalIgnoreCase))
                            success = StopOne(candidate.Id, installedExecutable) && success;
                    } catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { }
                }
            }
            return success;
        }
    }
}
