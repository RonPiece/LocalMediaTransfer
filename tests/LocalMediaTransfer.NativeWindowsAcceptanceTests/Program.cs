using LocalMediaTransfer.NativeWindowsAcceptance;

var tests = new (string Name, Func<Task> Run)[]
{
    ("explicit opt-in is required", ExplicitOptIn),
    ("role and safety bounds are validated", OptionBounds),
    ("receiver diagnostics are allow-listed", ReceiverDiagnostics),
    ("diagnostic reports omit arbitrary details", DiagnosticReportRedaction)
};

int failed = 0;
foreach (var test in tests)
{
    try
    {
        await test.Run();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception exception)
    {
        failed++;
        Console.Error.WriteLine($"FAIL {test.Name}: {exception.Message}");
    }
}
Console.WriteLine($"Native Windows acceptance tests: {tests.Length - failed} passed, {failed} failed");
return failed == 0 ? 0 : 1;

static Task ExplicitOptIn()
{
    AssertThrows<AcceptanceOptionException>(() =>
        AcceptanceOptions.Parse(["--role", "sender"]));
    return Task.CompletedTask;
}

static Task OptionBounds()
{
    AcceptanceOptions sender = AcceptanceOptions.Parse(
        ["--role", "sender", "--confirm-two-pc", "--environment", "test"]);
    Assert(sender.Role == AcceptanceRole.Sender && sender.DiscoveryPort == 45893,
        "The test sender environment was not parsed.");
    AssertThrows<AcceptanceOptionException>(() => AcceptanceOptions.Parse(
        ["--role", "sender", "--confirm-two-pc", "--large-file-mib", "8"]));
    AssertThrows<AcceptanceOptionException>(() => AcceptanceOptions.Parse(
        ["--role", "observer", "--confirm-two-pc"]));
    return Task.CompletedTask;
}

static Task ReceiverDiagnostics()
{
    string line = "[info] [native_windows_diagnostic] " +
        "{\"event\":\"transfer_requested\",\"fileCount\":1000," +
        "\"totalBytes\":1024000,\"credential\":\"must-not-copy\"," +
        "\"filename\":\"must-not-copy.bin\"}";
    Assert(ReceiverDiagnosticParser.TryParse(line, out var entry) && entry is not null,
        "The safe receiver event was not parsed.");
    Assert(entry!.FileCount == 1000 && entry.ByteCount == 1024000,
        "Allow-listed numeric fields were lost.");
    Assert(!ReceiverDiagnosticParser.TryParse(
        "[native_windows_diagnostic] {\"event\":\"credential_seen\"}", out _),
        "An unknown diagnostic event was accepted.");
    return Task.CompletedTask;
}

static async Task DiagnosticReportRedaction()
{
    string root = CreateTestRoot();
    try
    {
        string reportPath = Path.Combine(root, "report.json");
        var report = new AcceptanceDiagnosticReport("sender", "test");
        report.Record("unsafe secret text", "passed", new string('a', 64), 1, 2);
        report.Finish("failed");
        await report.SaveAsync(reportPath);
        string json = await File.ReadAllTextAsync(reportPath);
        Assert(!json.Contains(new string('a', 64), StringComparison.Ordinal),
            "An arbitrary token-like error value reached the report.");
        Assert(json.Contains("unknown_stage", StringComparison.Ordinal),
            "An unsafe stage label was not replaced.");
    }
    finally
    {
        SafeDelete(root);
    }
}

static string CreateTestRoot()
{
    string root = Path.Combine(Path.GetTempPath(), "LocalMediaTransfer.Tests",
        Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    return root;
}

static void SafeDelete(string path)
{
    string allowed = Path.GetFullPath(Path.Combine(Path.GetTempPath(),
        "LocalMediaTransfer.Tests")) + Path.DirectorySeparatorChar;
    string resolved = Path.GetFullPath(path);
    if (!resolved.StartsWith(allowed, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Unsafe test cleanup path.");
    if (Directory.Exists(resolved)) Directory.Delete(resolved, true);
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static void AssertThrows<T>(Action action) where T : Exception
{
    try { action(); }
    catch (T) { return; }
    throw new InvalidOperationException($"Expected {typeof(T).Name}.");
}
