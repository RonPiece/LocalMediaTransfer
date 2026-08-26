using LocalMediaTransfer.WindowsClient;

namespace LocalMediaTransfer.NativeWindowsAcceptance;

public sealed class SenderAcceptanceRunner(AcceptanceOptions options)
{
    private readonly AcceptanceDiagnosticReport _report =
        new("sender", options.Environment);

    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        using var workspace = new AcceptanceWorkspace(options.KeepSourceFiles);
        try
        {
            WriteSafetyNotice(workspace.RunLabel);
            DiscoveredReceiver receiver = await DiscoverReceiverAsync(cancellationToken);
            TrustedReceiver trusted = await PairAsync(receiver, workspace.RunLabel,
                cancellationToken);
            await RunBoundaryAsync(trusted, workspace, cancellationToken);
            await RunCancellationAsync(trusted, workspace, cancellationToken);
            await RunRestartAsync(trusted, workspace, cancellationToken);
            _report.Finish("passed");
            Console.WriteLine("All sender acceptance stages passed.");
            return 0;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _report.Record("runner", "cancelled", "cancelled");
            _report.Finish("cancelled");
            Console.Error.WriteLine("Acceptance run cancelled.");
            return 2;
        }
        catch (Exception exception)
        {
            _report.Record("runner", "failed",
                AcceptanceDiagnosticReport.ErrorCode(exception));
            _report.Finish("failed");
            Console.Error.WriteLine($"Acceptance run failed: {exception.Message}");
            return 1;
        }
        finally
        {
            try
            {
                await _report.SaveAsync(options.ReportPath);
                Console.WriteLine($"Sanitized sender report: {options.ReportPath}");
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"Could not save the diagnostic report: {exception.Message}");
            }
        }
    }

    private void WriteSafetyNotice(string runLabel)
    {
        Console.WriteLine("This is an interactive, opt-in physical two-PC test.");
        Console.WriteLine("It writes 1,000 generated files plus one recovery file to the");
        Console.WriteLine("receiver's configured upload folder and requires approval for every transfer.");
        Console.WriteLine("It never disables TLS pinning, pairing verification, or scoped grants.");
        Console.WriteLine($"Cleanup label for generated receiver files/devices: {runLabel}");
        Console.WriteLine();
    }

    private async Task<DiscoveredReceiver> DiscoverReceiverAsync(
        CancellationToken cancellationToken)
    {
        _report.Record("discovery", "started");
        DiscoveredReceiver receiver;
        if (!string.IsNullOrWhiteSpace(options.ManualAddress))
        {
            if (!DiscoveryClient.TryParseManualAddress(options.ManualAddress,
                    options.HttpsPort, out string address, out int port))
                throw new AcceptanceOptionException(
                    "--manual must be a private/local IPv4 address with an optional HTTPS port.");
            receiver = await new PairingClient().ProbeManualAsync(address, port,
                options.Environment, cancellationToken);
            _report.Record("manual_discovery", "passed");
        }
        else
        {
            Console.WriteLine("Scanning active private IPv4 adapters (maximum 1,024 destinations)...");
            IReadOnlyList<DiscoveredReceiver> receivers = await new DiscoveryClient()
                .ScanAsync(options.Environment, options.DiscoveryPort, cancellationToken);
            if (receivers.Count == 0)
                throw new NativeClientException("receiver_not_found",
                    "No receiver was found. Check consent, discovery, firewall, VPN, and guest isolation.");
            for (int index = 0; index < receivers.Count; index++)
                Console.WriteLine($"  {index + 1}. {receivers[index].Name} ({receivers[index].Address}) " +
                    (receivers[index].SupportsNativeWindows ? "native v1" : "browser only"));
            int selected = ReadSelection(receivers.Count);
            receiver = receivers[selected - 1];
            _report.Record("udp_discovery", "passed", fileCount: receivers.Count);
        }
        if (!receiver.SupportsNativeWindows)
            throw new NativeClientException("native_transfer_unavailable",
                "The selected receiver does not advertise native Windows transfer v1.");
        _report.Record("discovery", "passed");
        return receiver;
    }

    private async Task<TrustedReceiver> PairAsync(DiscoveredReceiver receiver,
        string runLabel, CancellationToken cancellationToken)
    {
        Console.WriteLine();
        Console.WriteLine("On the receiver, open Receive > Pair a Windows computer now.");
        Console.Write("Press Enter when its two-minute pairing window is open: ");
        Console.ReadLine();
        _report.Record("pairing", "started");
        var client = new PairingClient();
        PairingSession session = await client.StartAsync(receiver,
            Guid.NewGuid().ToString(), $"LMT acceptance {runLabel}", cancellationToken);
        Console.WriteLine();
        Console.WriteLine($"Security code: {session.SecurityCode}");
        Console.WriteLine("Compare it with the receiver. Type MATCH only when both codes are identical.");
        string confirmation = Console.ReadLine()?.Trim() ?? "";
        if (!confirmation.Equals("MATCH", StringComparison.Ordinal))
        {
            try { await client.RejectAsync(session, cancellationToken); }
            catch { /* The local mismatch remains authoritative. */ }
            throw new NativeClientException("security_code_not_confirmed",
                "The pairing code was not confirmed; the candidate credential was discarded.");
        }
        _report.Record("pairing_code_confirmation", "passed");
        await client.ConfirmAsync(session, cancellationToken);
        Console.WriteLine("Approve the pairing request on the receiver.");
        TrustedReceiver trusted = await client.WaitForApprovalAsync(session,
            cancellationToken);
        _report.Record("pairing_approval", "passed");
        _report.Record("pairing", "passed");
        return trusted;
    }

    private async Task RunBoundaryAsync(TrustedReceiver receiver,
        AcceptanceWorkspace workspace, CancellationToken cancellationToken)
    {
        Console.WriteLine();
        Console.WriteLine("Generating the 1,000-file boundary set...");
        IReadOnlyList<string> paths = workspace.CreateBoundaryFiles();
        string session = "win-" + NativeSecurity.GenerateHex(16);
        IReadOnlyList<TransferSource> sources = NativeTransferClient.PrepareFiles(paths, session);
        _report.Record("transfer_1000_files", "started", fileCount: sources.Count,
            byteCount: sources.Sum(file => file.SizeBytes));
        Console.WriteLine("Approve the 1,000-file transfer on the receiver.");
        int lastReported = 0;
        var progress = new InlineProgress<NativeTransferProgress>(value =>
        {
            if (value.TerminalFiles < lastReported + 100 &&
                value.TerminalFiles != value.TotalFiles) return;
            lastReported = value.TerminalFiles;
            Console.WriteLine($"  {value.TerminalFiles}/{value.TotalFiles} terminal files");
        });
        NativeTransferSummary summary = await new NativeTransferClient().SendAsync(
            receiver, sources, true, progress, cancellationToken);
        if (summary.Cancelled || summary.Files.Count != 1000 ||
            summary.Files.Any(file => file.State != TransferFileState.Completed))
            throw new NativeClientException("boundary_transfer_incomplete",
                "The 1,000-file transfer did not complete every generated file.");
        _report.Record("transfer_1000_files", "passed", fileCount: 1000,
            byteCount: summary.AcknowledgedBytes);
    }

    private async Task RunCancellationAsync(TrustedReceiver receiver,
        AcceptanceWorkspace workspace, CancellationToken cancellationToken)
    {
        Console.WriteLine();
        string path = workspace.CreateLargeFile("Cancellation", options.LargeFileMiB);
        IReadOnlyList<TransferSource> sources = NativeTransferClient.PrepareFiles([path],
            "win-" + NativeSecurity.GenerateHex(16));
        long threshold = options.CancelAfterMiB * 1024L * 1024L;
        using var stageCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken);
        int requested = 0;
        var progress = new InlineProgress<NativeTransferProgress>(value =>
        {
            if (value.AcknowledgedBytes < threshold ||
                Interlocked.Exchange(ref requested, 1) != 0) return;
            Console.WriteLine($"  Cancelling after {value.AcknowledgedBytes / 1_000_000d:F1} MB acknowledged.");
            stageCancellation.Cancel();
        });
        _report.Record("sender_cancellation", "started", fileCount: 1,
            byteCount: threshold);
        Console.WriteLine("Approve the cancellation transfer on the receiver.");
        NativeTransferSummary summary = await new NativeTransferClient().SendAsync(
            receiver, sources, false, progress, stageCancellation.Token);
        if (!summary.Cancelled || requested == 0)
            throw new NativeClientException("cancellation_not_observed",
                "The transfer completed before sender cancellation was observed.");
        _report.Record("sender_cancellation", "passed", fileCount: 1,
            byteCount: summary.AcknowledgedBytes);
    }

    private async Task RunRestartAsync(TrustedReceiver receiver,
        AcceptanceWorkspace workspace, CancellationToken cancellationToken)
    {
        Console.WriteLine();
        string path = workspace.CreateLargeFile("Receiver-Restart",
            options.LargeFileMiB + 1);
        IReadOnlyList<TransferSource> sources = NativeTransferClient.PrepareFiles([path],
            "win-" + NativeSecurity.GenerateHex(16));
        long threshold = options.RestartAfterMiB * 1024L * 1024L;
        int prompted = 0;
        var progress = new InlineProgress<NativeTransferProgress>(value =>
        {
            if (value.AcknowledgedBytes < threshold ||
                Interlocked.Exchange(ref prompted, 1) != 0) return;
            Console.WriteLine();
            Console.WriteLine("RESTART CHECK: use the receiver GUI's Restart Server command.");
            Console.Write("Wait until the receiver reports ready, then press Enter here: ");
            Console.ReadLine();
        });
        _report.Record("receiver_restart_invalidates_grant", "started", fileCount: 1,
            byteCount: threshold);
        Console.WriteLine("Approve the receiver-restart transfer on the receiver.");
        bool interrupted = false;
        string interruptionCode = "transfer_interrupted";
        try
        {
            NativeTransferSummary summary = await new NativeTransferClient().SendAsync(
                receiver, sources, false, progress, cancellationToken);
            interrupted = prompted != 0 && (summary.Cancelled ||
                summary.Files.Any(file => file.State != TransferFileState.Completed));
            interruptionCode = summary.Files.FirstOrDefault(file =>
                file.State == TransferFileState.Failed)?.ErrorCode ?? interruptionCode;
        }
        catch (NativeClientException exception) when (prompted != 0)
        {
            interrupted = true;
            interruptionCode = exception.Code;
        }
        if (!interrupted)
            throw new NativeClientException("restart_grant_was_not_invalidated",
                "The pre-restart transfer unexpectedly completed with its old grant.");
        _report.Record("receiver_restart_invalidates_grant", "passed",
            AcceptanceDiagnosticReport.ErrorCode(new NativeClientException(
                interruptionCode, "Sanitized restart result.")));

        string recoveryPath = workspace.CreateRecoveryFile();
        IReadOnlyList<TransferSource> recovery = NativeTransferClient.PrepareFiles(
            [recoveryPath], "win-" + NativeSecurity.GenerateHex(16));
        _report.Record("receiver_restart_recovery", "started", fileCount: 1,
            byteCount: recovery[0].SizeBytes);
        Console.WriteLine("Approve the post-restart recovery transfer on the receiver.");
        NativeTransferSummary recoverySummary = await new NativeTransferClient().SendAsync(
            receiver, recovery, true, null, cancellationToken);
        if (recoverySummary.Cancelled || recoverySummary.Files.Count != 1 ||
            recoverySummary.Files[0].State != TransferFileState.Completed)
            throw new NativeClientException("restart_recovery_failed",
                "A new approval after receiver restart did not complete.");
        _report.Record("receiver_restart_recovery", "passed", fileCount: 1,
            byteCount: recoverySummary.AcknowledgedBytes);
    }

    private static int ReadSelection(int count)
    {
        if (count == 1) return 1;
        Console.Write("Select receiver number: ");
        return int.TryParse(Console.ReadLine(), out int selected) &&
            selected >= 1 && selected <= count
                ? selected : throw new AcceptanceOptionException("Invalid receiver selection.");
    }

    private sealed class InlineProgress<T>(Action<T> callback) : IProgress<T>
    {
        public void Report(T value) => callback(value);
    }
}
