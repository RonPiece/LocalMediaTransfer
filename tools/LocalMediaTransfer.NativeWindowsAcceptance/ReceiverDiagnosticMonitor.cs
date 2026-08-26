namespace LocalMediaTransfer.NativeWindowsAcceptance;

public sealed class ReceiverDiagnosticMonitor(AcceptanceOptions options)
{
    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        var report = new AcceptanceDiagnosticReport("receiver", options.Environment);
        Console.WriteLine("Receiver diagnostics are local and allow-listed.");
        Console.WriteLine("Raw server log lines, addresses, names, credentials, codes, pins,");
        Console.WriteLine("request IDs, transfer IDs, filenames, and manifests are not copied.");
        Console.WriteLine($"Monitoring for up to {options.DurationMinutes} minutes. Press Ctrl+C to stop.");
        long offset = File.Exists(options.ReceiverLogPath)
            ? new FileInfo(options.ReceiverLogPath).Length : 0;
        string pending = "";
        using var duration = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        duration.CancelAfter(TimeSpan.FromMinutes(options.DurationMinutes));
        try
        {
            while (!duration.IsCancellationRequested)
            {
                if (File.Exists(options.ReceiverLogPath))
                {
                    var info = new FileInfo(options.ReceiverLogPath);
                    if (info.Length < offset)
                    {
                        offset = 0;
                        pending = "";
                    }
                    if (info.Length > offset)
                    {
                        using FileStream stream = new(options.ReceiverLogPath, FileMode.Open,
                            FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                        stream.Seek(offset, SeekOrigin.Begin);
                        using var reader = new StreamReader(stream);
                        string text = pending + await reader.ReadToEndAsync(duration.Token);
                        offset = stream.Position;
                        string[] lines = text.Replace("\r\n", "\n", StringComparison.Ordinal)
                            .Split('\n');
                        pending = lines[^1];
                        foreach (string line in lines[..^1])
                        {
                            if (!ReceiverDiagnosticParser.TryParse(line, out var entry) ||
                                entry is null) continue;
                            report.Record(entry.Stage, entry.Outcome, fileCount: entry.FileCount,
                                byteCount: entry.ByteCount);
                            Console.WriteLine($"{entry.TimestampUtc:HH:mm:ss} {entry.Stage}" +
                                (entry.FileCount is int count ? $" files={count}" : ""));
                        }
                    }
                }
                await Task.Delay(500, duration.Token);
            }
        }
        catch (OperationCanceledException) when (duration.IsCancellationRequested)
        {
            // A configured timeout or Ctrl+C ends diagnostic collection normally.
        }
        catch (Exception exception)
        {
            report.Record("receiver_monitor", "failed",
                AcceptanceDiagnosticReport.ErrorCode(exception));
            report.Finish("failed");
            await report.SaveAsync(options.ReportPath);
            Console.Error.WriteLine($"Receiver diagnostic monitor failed: {exception.Message}");
            return 1;
        }

        report.Finish("completed");
        await report.SaveAsync(options.ReportPath);
        Console.WriteLine($"Sanitized receiver report: {options.ReportPath}");
        return 0;
    }
}
