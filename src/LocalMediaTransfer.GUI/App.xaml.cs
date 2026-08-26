using Microsoft.UI.Xaml;
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using LocalMediaTransfer.GUI.Services;
using LocalMediaTransfer.GUI.AppServices;

namespace LocalMediaTransfer.GUI
{
    /// <summary>
    /// Provides application-specific behavior to supplement the default Application class.
    /// </summary>
    public partial class App : Application
    {
        private static readonly object ExceptionLogLock = new();
        private static Mutex? _singleInstanceMutex;
        private Window? _window;
        private bool _isSecondaryInstance;

        /// <summary>
        /// Static reference to main window for folder pickers and dialogs.
        /// </summary>
        public static Window? MainWindow { get; private set; }

        /// <summary>
        /// Initializes the singleton application object.
        /// </summary>
        public App()
        {
            EnsureSingleInstance();
            InitializeComponent();
            UnhandledException += OnXamlUnhandledException;
            AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
            AppDomain.CurrentDomain.ProcessExit += (_, _) => ReleaseSingleInstanceMutex();
        }

        /// <summary>
        /// Invoked when the application is launched.
        /// </summary>
        protected override void OnLaunched(LaunchActivatedEventArgs args)
        {
            if (_isSecondaryInstance)
            {
                Current.Exit();
                return;
            }

            _window = new MainWindow();
            MainWindow = _window;
            _window.Activate();
        }

        private void EnsureSingleInstance()
        {
            try
            {
                _singleInstanceMutex = new Mutex(
                    initiallyOwned: true,
                    ApplicationEnvironment.Current.GuiMutexName,
                    out bool createdNew);
                if (!createdNew)
                {
                    _isSecondaryInstance = true;
                    try { _singleInstanceMutex.Dispose(); } catch { }
                    _singleInstanceMutex = null;
                    ShowAlreadyRunningMessage();
                }
            }
            catch
            {
                // If mutex creation fails, we still allow app startup.
            }
        }

        private static void ReleaseSingleInstanceMutex()
        {
            try
            {
                _singleInstanceMutex?.ReleaseMutex();
            }
            catch
            {
                // Ignore if this process does not own the mutex.
            }
            finally
            {
                try { _singleInstanceMutex?.Dispose(); } catch { }
                _singleInstanceMutex = null;
            }
        }

        private static void ShowAlreadyRunningMessage()
        {
            try
            {
                _ = MessageBox(IntPtr.Zero,
                    $"{ApplicationEnvironment.Current.DisplayName} is already running (possibly in the system tray).",
                    ApplicationEnvironment.Current.DisplayName,
                    0x00000040);
            }
            catch
            {
                // Best effort only.
            }
        }

        private static void OnXamlUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
        {
            LogDiagnostic("XAML", e.Message, e.Exception);
        }

        private static void OnDomainUnhandledException(object sender, System.UnhandledExceptionEventArgs e)
        {
            var exception = e.ExceptionObject as Exception;
            LogDiagnostic("AppDomain", e.ExceptionObject?.ToString(), exception);
        }

        private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
        {
            LogDiagnostic("TaskScheduler", e.Exception.Message, e.Exception);
        }

        internal static void LogDiagnostic(string source, string? message, Exception? exception = null)
        {
            try
            {
                var logLine = SecretRedactor.Redact(
                    $"{DateTimeOffset.Now:O} [{source}] {message ?? exception?.Message ?? "Unknown exception"}{Environment.NewLine}{exception}{Environment.NewLine}");
                Debug.WriteLine(logLine);

                lock (ExceptionLogLock)
                {
                    var logDir = ApplicationEnvironment.Current.LogDirectory;
                    Directory.CreateDirectory(logDir);
                    File.AppendAllText(Path.Combine(logDir, "gui.log"), logLine + Environment.NewLine);
                }
            }
            catch
            {
                // Exception logging must never become the crash source.
            }
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
    }
}
