using System.Collections.ObjectModel;
using System.Collections.Generic;
using System.Threading;
using System;
using System.IO;
using System.Linq;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Services;
using LocalMediaTransfer.WindowsClient;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Navigation;
using Windows.Storage.Pickers;

namespace LocalMediaTransfer.GUI.Features.Send;

public sealed partial class SendPage : Page
{
    private readonly ObservableCollection<ReceiverItem> _receivers = [];
    private readonly ObservableCollection<SelectedFileItem> _files = [];
    private readonly DiscoveryClient _discovery = new();
    private readonly PairingClient _pairing = new();
    private MainWindow? _window;
    private TrustedReceiverStore? _trustStore;
    private string _clientId = "";
    private TrustedReceiver? _connectedReceiver;
    private IReadOnlyList<TransferSource> _sources = [];
    private CancellationTokenSource? _activity;
    private SendState _state = SendState.Consent;
    private bool _isNavigated;
    private bool _trustStoreCorrupt;

    public SendPage()
    {
        InitializeComponent();
        NavigationCacheMode = NavigationCacheMode.Required;
        ReceiverList.ItemsSource = _receivers;
        FilesList.ItemsSource = _files;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _isNavigated = true;
        if (e.Parameter is not MainWindow window) return;
        if (_window is not null && IsTransferActive())
        {
            _window.NativeTransferCancellationRequested -= OnNativeTransferCancellationRequested;
            _window.NativeTransferCancellationRequested += OnNativeTransferCancellationRequested;
            return;
        }
        _window = window;
        _window.NativeTransferCancellationRequested -= OnNativeTransferCancellationRequested;
        _window.NativeTransferCancellationRequested += OnNativeTransferCancellationRequested;
        string root = Path.Combine(ApplicationEnvironment.Current.DataRoot, "windows-client");
        _trustStore = new TrustedReceiverStore(root, ApplicationEnvironment.Current.Name);
        _clientId = new ClientIdentityStore(root).LoadOrCreate();
        LoadRememberedReceivers();
        SetState(AppSettingsService.NearbySenderDiscoveryConsent
            ? SendState.ReceiverSelected : SendState.Consent,
            "Choose a remembered receiver, scan nearby, or enter an address manually.");
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        base.OnNavigatedFrom(e);
        _isNavigated = false;
        if (_window is not null && !IsTransferActive())
            _window.NativeTransferCancellationRequested -= OnNativeTransferCancellationRequested;
    }

    private void LoadRememberedReceivers()
    {
        _receivers.Clear();
        try
        {
            foreach (TrustedReceiver receiver in _trustStore!.Load()
                .OrderByDescending(item => item.LastSeen))
                _receivers.Add(ReceiverItem.Remembered(receiver));
        }
        catch (NativeClientException exception)
        {
            _trustStoreCorrupt = exception.Code == "trust_store_corrupt";
            if (_trustStoreCorrupt)
            {
                ForgetButton.Content = "Clear corrupt saved trust";
                ForgetButton.IsEnabled = true;
            }
            SetError(exception.Message);
        }
    }

    private async void Scan_Click(object sender, RoutedEventArgs e)
    {
        if (!AppSettingsService.NearbySenderDiscoveryConsent)
        {
            bool consent;
            try
            {
                consent = await DialogService.ConfirmAsync(XamlRoot,
                    "Find nearby Windows computers?",
                    "Local Media Transfer will scan up to 1,024 private IPv4 addresses on active local adapters. Discovery packets contain no credentials. VPNs, guest Wi-Fi, and firewall rules can prevent discovery.",
                    "Allow Scan", "Cancel", ContentDialogButton.Primary);
            }
            catch (Exception exception)
            {
                SetError(exception.Message);
                return;
            }
            if (!consent) return;
            AppSettingsService.NearbySenderDiscoveryConsent = true;
        }

        _activity?.Cancel();
        _activity = new CancellationTokenSource();
        SetState(SendState.Searching, "Searching active private networks…");
        ScanButton.IsEnabled = false;
        try
        {
            IReadOnlyList<DiscoveredReceiver> found = await _discovery.ScanAsync(
                ApplicationEnvironment.Current.Name, 45892, _activity.Token);
            IReadOnlyList<TrustedReceiver> trusted = _trustStore!.Load();
            _receivers.Clear();
            foreach (TrustedReceiver saved in trusted.OrderByDescending(item => item.LastSeen))
            {
                DiscoveredReceiver? live = found.FirstOrDefault(item => item.ServerId == saved.ServerId);
                _receivers.Add(ReceiverItem.Remembered(saved, live));
            }
            foreach (DiscoveredReceiver receiver in found.Where(item =>
                trusted.All(saved => saved.ServerId != item.ServerId)))
                _receivers.Add(ReceiverItem.FromDiscovered(receiver));

            if (_receivers.Count == 0)
                SetState(SendState.Error,
                    "No receivers found. Check discovery consent, receiver readiness, private-network firewall access, VPN settings, and guest-network isolation. You can rescan or enter a private IPv4 address manually.");
            else
                SetState(SendState.ReceiverSelected,
                    "Remembered receivers are listed first. Select one to continue.");
        }
        catch (OperationCanceledException) { SetState(SendState.Cancelled, "Scan cancelled."); }
        catch (Exception exception) { SetError(exception.Message); }
        finally { ScanButton.IsEnabled = true; }
    }

    private async void ManualAddress_Click(object sender, RoutedEventArgs e)
    {
        var input = new TextBox
        {
            Header = "Private IPv4 address and optional HTTPS port",
            PlaceholderText = "192.168.1.24:8443"
        };
        AutomationProperties.SetName(input, "Receiver private IPv4 address");
        var dialog = new ContentDialog
        {
            Title = "Enter receiver address",
            Content = input,
            PrimaryButtonText = "Continue",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot
        };
        try
        {
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        }
        catch (Exception exception)
        {
            SetError(exception.Message);
            return;
        }
        if (!DiscoveryClient.TryParseManualAddress(input.Text,
            ApplicationEnvironment.Current.HttpsPort, out string address, out int port))
        {
            SetError("Enter a private/local IPv4 address with an optional port. Public addresses and DNS names are not allowed.");
            return;
        }
        _activity?.Cancel(); _activity = new CancellationTokenSource();
        SetState(SendState.Searching, "Checking the receiver identity…");
        try
        {
            DiscoveredReceiver receiver = await _pairing.ProbeManualAsync(address, port,
                ApplicationEnvironment.Current.Name, _activity.Token);
            TrustedReceiver? trusted = _trustStore!.Load().FirstOrDefault(item =>
                item.ServerId == receiver.ServerId);
            var item = trusted is null ? ReceiverItem.FromDiscovered(receiver) :
                ReceiverItem.Remembered(trusted, receiver);
            _receivers.Insert(0, item);
            ReceiverList.SelectedItem = item;
            SetState(SendState.ReceiverSelected,
                "Manual address verified. Pairing and certificate verification are still required.");
        }
        catch (Exception exception) { SetError(exception.Message); }
    }

    private void ReceiverList_SelectionChanged(object sender,
        SelectionChangedEventArgs e)
    {
        ReceiverItem? selected = ReceiverList.SelectedItem as ReceiverItem;
        ConnectButton.IsEnabled = selected is not null;
        ForgetButton.IsEnabled = selected?.Trusted is not null;
        if (selected is not null) SetState(SendState.ReceiverSelected,
            selected.IdentityChanged
                ? "Receiver identity changed. Forget it and pair again; there is no bypass."
                : "Receiver selected. Connect or pair to continue.");
    }

    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        if (ReceiverList.SelectedItem is not ReceiverItem selected) return;
        if (selected.IdentityChanged)
        {
            SetError("The receiver certificate fingerprint changed. Forget this receiver and pair again.");
            return;
        }
        if (selected.Trusted is not null)
        {
            _connectedReceiver = selected.Trusted;
            SetState(SendState.Connected, "Connected with a pinned receiver identity. Choose files.");
            return;
        }
        if (selected.Discovered?.SupportsNativeWindows != true)
        {
            SetError("This receiver does not support native Windows transfer. Use Browser transfer on its Receive page.");
            return;
        }

        _activity?.Cancel(); _activity = new CancellationTokenSource();
        SetState(SendState.Pairing, "Creating a first-pairing request…");
        try
        {
            PairingSession session = await _pairing.StartAsync(selected.Discovered,
                _clientId, Environment.MachineName, _activity.Token);
            bool matches = await DialogService.ConfirmAsync(XamlRoot,
                "Compare the security code",
                $"Security code\n\n{session.SecurityCode}\n\nConfirm only if the receiver shows exactly the same code.",
                "Codes Match", "Codes Differ", ContentDialogButton.Primary);
            if (!matches)
            {
                try { await _pairing.RejectAsync(session, _activity.Token); }
                catch { /* Preserve the local mismatch as the primary error. */ }
                throw new NativeClientException("security_code_mismatch",
                    "Pairing was cancelled because the security codes did not match.");
            }
            await _pairing.ConfirmAsync(session, _activity.Token);
            SetState(SendState.Pairing, "Waiting for approval on the receiver…");
            TrustedReceiver trusted = await _pairing.WaitForApprovalAsync(session,
                _activity.Token);
            _trustStore!.Upsert(trusted);
            _connectedReceiver = trusted;
            LoadRememberedReceivers();
            SetState(SendState.Connected,
                "Paired with an exact certificate pin. Choose files.");
        }
        catch (OperationCanceledException) { SetState(SendState.Cancelled, "Pairing cancelled."); }
        catch (Exception exception) { SetError(exception.Message); }
    }

    private void Forget_Click(object sender, RoutedEventArgs e)
    {
        if (_trustStoreCorrupt)
        {
            _trustStore!.ClearAfterUserConfirmation();
            _trustStoreCorrupt = false;
            ForgetButton.Content = "Forget";
            ForgetButton.IsEnabled = false;
            LoadRememberedReceivers();
            SetState(SendState.ReceiverSelected,
                "Corrupt saved trust was cleared. Pair receivers again before sending.");
            return;
        }
        if (ReceiverList.SelectedItem is not ReceiverItem { Trusted: not null } selected) return;
        _trustStore!.Forget(selected.Trusted.ServerId);
        if (_connectedReceiver?.ServerId == selected.Trusted.ServerId) _connectedReceiver = null;
        LoadRememberedReceivers();
        SetState(SendState.ReceiverSelected,
            "Receiver forgotten. Open pairing on it before pairing again.");
    }

    private async void ChooseFiles_Click(object sender, RoutedEventArgs e)
    {
        if (_window is null || _connectedReceiver is null) return;
        try
        {
            var picker = new FileOpenPicker
            {
                SuggestedStartLocation = PickerLocationId.PicturesLibrary
            };
            picker.FileTypeFilter.Add("*");
            nint hwnd = WinRT.Interop.WindowNative.GetWindowHandle(_window);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
            IReadOnlyList<Windows.Storage.StorageFile> picked =
                await picker.PickMultipleFilesAsync();
            if (picked.Count == 0) return;
            if (picked.Count > 1000)
                throw new NativeClientException("invalid_file_count",
                    "Select no more than 1,000 files.");
            string session = "win-" + NativeSecurity.GenerateHex(16);
            var valid = new List<TransferSource>();
            _files.Clear();
            foreach (Windows.Storage.StorageFile file in picked)
            {
                try
                {
                    TransferSource source = NativeTransferClient.PrepareFiles(
                        [file.Path], session).Single();
                    valid.Add(source);
                    _files.Add(new SelectedFileItem(source.FileId, source.Name,
                        FormatBytes(source.SizeBytes), "Ready"));
                }
                catch (NativeClientException exception)
                {
                    _files.Add(new SelectedFileItem("failed-" + Guid.NewGuid().ToString("N"),
                        file.Name, "—", "Failed: " + exception.Message));
                }
            }
            _sources = valid;
            SelectionSummary.Text = $"{picked.Count:N0} selected · {_sources.Count:N0} ready · {FormatBytes(_sources.Sum(file => file.SizeBytes))}";
            ClearFilesButton.IsEnabled = true;
            SetState(SendState.FileSelection, "Files are ready. The receiver must approve this transfer.");
        }
        catch (Exception exception) { SetError(exception.Message); }
    }

    private void ClearFiles_Click(object sender, RoutedEventArgs e)
    {
        _sources = []; _files.Clear();
        SelectionSummary.Text = "No files selected";
        ClearFilesButton.IsEnabled = false;
        SetState(_connectedReceiver is null ? SendState.ReceiverSelected : SendState.Connected,
            "File selection cleared.");
    }

    private void RemoveFile_Click(object sender, RoutedEventArgs e)
    {
        if (IsTransferActive() || sender is not Button { Tag: string fileId }) return;
        SelectedFileItem? display = _files.FirstOrDefault(item => item.FileId == fileId);
        if (display is not null) _files.Remove(display);
        _sources = _sources.Where(item => item.FileId != fileId).ToArray();
        SelectionSummary.Text = _files.Count == 0 ? "No files selected" :
            $"{_files.Count:N0} selected · {_sources.Count:N0} ready · {FormatBytes(_sources.Sum(file => file.SizeBytes))}";
        ClearFilesButton.IsEnabled = _files.Count > 0;
        SetState(_sources.Count > 0 ? SendState.FileSelection : SendState.Connected,
            _sources.Count > 0 ? "Selection updated." : "Choose at least one transferable file.");
    }

    private async void Send_Click(object sender, RoutedEventArgs e)
    {
        if (_connectedReceiver is null || _sources.Count == 0) return;
        _activity?.Cancel(); _activity = new CancellationTokenSource();
        if (_window is not null) _window.IsNativeTransferActive = true;
        SetState(SendState.WaitingForApproval, "Waiting for approval on the receiver…");
        TransferProgress.Value = 0;
        var progress = new Progress<NativeTransferProgress>(value =>
        {
            SetState(SendState.Uploading,
                $"Uploading: {value.TerminalFiles}/{value.TotalFiles} files · {value.CurrentMBps:F1} MB/s");
            double filePart = value.TotalFiles == 0 ? 0 :
                value.TerminalFiles * 100d / value.TotalFiles;
            TransferProgress.Value = Math.Clamp(filePart, 0, 100);
            ProgressText.Text = $"{value.AcknowledgedBytes:N0} bytes acknowledged · {value.TerminalFiles}/{value.TotalFiles} files finished";
            if (value.File is not null)
            {
                int index = _files.ToList().FindIndex(item =>
                    item.FileId == value.File.FileId);
                if (index >= 0)
                    _files[index] = _files[index] with
                    { StateText = value.File.State.ToString() };
            }
        });
        try
        {
            NativeTransferSummary summary = await new NativeTransferClient().SendAsync(
                _connectedReceiver, _sources, SkipDuplicatesCheckBox.IsChecked != false,
                progress, _activity.Token);
            int failed = summary.Files.Count(file => file.State == TransferFileState.Failed);
            TransferProgress.Value = 100;
            if (summary.Cancelled) SetState(SendState.Cancelled, "Transfer cancelled. Your file selection was retained.");
            else if (failed > 0) SetState(SendState.Mixed,
                $"Transfer completed with {failed} failed files. Average {summary.AverageMBps:F1} MB/s; peak {summary.PeakMBps:F1} MB/s.");
            else SetState(SendState.Completed,
                $"Transfer complete. Average {summary.AverageMBps:F1} MB/s; peak {summary.PeakMBps:F1} MB/s.");
        }
        catch (NativeClientException exception) when (exception.Code == "credential_rejected")
        {
            _connectedReceiver = null;
            SetError("Receiver trust was revoked. Your files remain selected; pair again to resend.");
        }
        catch (OperationCanceledException) { SetState(SendState.Cancelled, "Transfer cancelled."); }
        catch (Exception exception) { SetError(exception.Message); }
        finally
        {
            if (_window is not null)
            {
                _window.IsNativeTransferActive = false;
                if (!_isNavigated)
                    _window.NativeTransferCancellationRequested -=
                        OnNativeTransferCancellationRequested;
            }
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => _activity?.Cancel();
    private void OnNativeTransferCancellationRequested() => _activity?.Cancel();
    private bool IsTransferActive() => _state is SendState.Preparing or
        SendState.WaitingForApproval or SendState.Uploading;

    private void SetState(SendState state, string message)
    {
        _state = state;
        StatusBar.Title = StateTitle(state);
        StatusBar.Message = message;
        StatusBar.Severity = state == SendState.Error ? InfoBarSeverity.Error :
            state is SendState.Completed ? InfoBarSeverity.Success :
            state is SendState.Mixed or SendState.Cancelled ? InfoBarSeverity.Warning :
            InfoBarSeverity.Informational;
        ProgressText.Text = message;
        ChooseFilesButton.IsEnabled = _connectedReceiver is not null &&
            SendStateMachine.CanSelectFiles(state);
        SendButton.IsEnabled = _connectedReceiver is not null &&
            SendStateMachine.CanSend(state, _sources.Count);
        CancelButton.IsEnabled = state is SendState.Searching or SendState.Pairing or
            SendState.WaitingForApproval or SendState.Uploading or SendState.Preparing;
        bool busy = state is SendState.Preparing or SendState.WaitingForApproval or
            SendState.Uploading;
        FilesList.IsEnabled = !busy;
        ClearFilesButton.IsEnabled = !busy && _files.Count > 0;
        ReceiverList.IsEnabled = !busy;
        ConnectButton.IsEnabled = !busy && ReceiverList.SelectedItem is not null;
    }

    private void SetError(string message) => SetState(SendState.Error, message);

    private static string StateTitle(SendState state) => state switch
    {
        SendState.Searching => "Searching",
        SendState.Pairing => "Pairing",
        SendState.Connected => "Receiver connected",
        SendState.FileSelection => "Files selected",
        SendState.WaitingForApproval => "Waiting for receiver approval",
        SendState.Uploading => "Uploading",
        SendState.Completed => "Completed",
        SendState.Mixed => "Completed with some failures",
        SendState.Cancelled => "Cancelled",
        SendState.Error => "Action needed",
        _ => "Choose a receiver"
    };

    private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        bool narrow = e.NewSize.Width < 640;
        ReceiverActions.Orientation = narrow ? Orientation.Vertical : Orientation.Horizontal;
        FileActions.Orientation = narrow ? Orientation.Vertical : Orientation.Horizontal;
        TransferActions.Orientation = narrow ? Orientation.Vertical : Orientation.Horizontal;
        RootPanel.Padding = narrow ? new Thickness(12, 12, 12, 20) :
            new Thickness(20, 20, 20, 24);
    }

    private static string FormatBytes(long bytes) => bytes >= 1_000_000_000
        ? $"{bytes / 1_000_000_000d:N1} GB"
        : bytes >= 1_000_000 ? $"{bytes / 1_000_000d:N1} MB"
        : $"{bytes / 1_000d:N1} KB";

    private sealed record SelectedFileItem(string FileId, string Name,
        string SizeText, string StateText);

    private sealed class ReceiverItem
    {
        private ReceiverItem(DiscoveredReceiver? discovered, TrustedReceiver? trusted,
            bool changed)
        {
            Discovered = discovered; Trusted = trusted; IdentityChanged = changed;
            string name = trusted?.Name ?? discovered?.Name ?? "Windows computer";
            string address = discovered?.Address ?? trusted?.Address ?? "Unavailable";
            DisplayName = name;
            Details = changed ? $"{address} · Identity changed — pair again" :
                trusted is not null ? $"{address} · Trusted (certificate pinned)" :
                discovered?.SupportsNativeWindows == true ? $"{address} · Available to pair" :
                $"{address} · Browser transfer available";
        }
        public DiscoveredReceiver? Discovered { get; }
        public TrustedReceiver? Trusted { get; }
        public bool IdentityChanged { get; }
        public string DisplayName { get; }
        public string Details { get; }

        public static ReceiverItem FromDiscovered(DiscoveredReceiver receiver) =>
            new(receiver, null, false);
        public static ReceiverItem Remembered(TrustedReceiver trusted,
            DiscoveredReceiver? discovered = null)
        {
            bool changed = discovered is not null &&
                !string.IsNullOrWhiteSpace(discovered.AdvertisedCertificateFingerprint) &&
                !string.Equals(discovered.AdvertisedCertificateFingerprint,
                    trusted.CertificateFingerprint, StringComparison.OrdinalIgnoreCase);
            TrustedReceiver effective = discovered is null || changed ? trusted : trusted with
            { Address = discovered.Address, HttpsPort = discovered.HttpsPort };
            return new(discovered, effective, changed);
        }
    }
}
