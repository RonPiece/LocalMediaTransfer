using LocalMediaTransfer.NativeWindowsAcceptance;

if (args.Contains("--help", StringComparer.OrdinalIgnoreCase) || args.Length == 0)
{
    AcceptanceOptions.WriteUsage(Console.Out);
    return args.Length == 0 ? 2 : 0;
}

try
{
    AcceptanceOptions options = AcceptanceOptions.Parse(args);
    using var cancellation = new CancellationTokenSource();
    Console.CancelKeyPress += (_, eventArgs) =>
    {
        eventArgs.Cancel = true;
        cancellation.Cancel();
    };
    return options.Role == AcceptanceRole.Sender
        ? await new SenderAcceptanceRunner(options).RunAsync(cancellation.Token)
        : await new ReceiverDiagnosticMonitor(options).RunAsync(cancellation.Token);
}
catch (AcceptanceOptionException exception)
{
    Console.Error.WriteLine($"Option error: {exception.Message}");
    AcceptanceOptions.WriteUsage(Console.Error);
    return 2;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Acceptance runner failed: {exception.Message}");
    return 1;
}
