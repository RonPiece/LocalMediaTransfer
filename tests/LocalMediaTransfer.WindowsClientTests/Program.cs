using System.Net;
using System.Text;
using LocalMediaTransfer.WindowsClient;

var tests = new (string Name, Func<Task> Run)[]
{
    ("security code test vector", SecurityCodeVector),
    ("confirmation proof test vector", ConfirmationProofVector),
    ("manual address validation", ManualAddressValidation),
    ("discovery uses packet source address", DiscoverySourceAddress),
    ("transfer source limits and stable IDs", TransferSourceValidation),
    ("retry classification", RetryClassification),
    ("invalid certificate pins fail before transport", InvalidCertificatePin),
    ("invalid approval identifiers are typed errors", InvalidApprovalIdentifiers),
    ("DPAPI trust persistence and corruption", TrustPersistence)
};

int failed = 0;
foreach (var test in tests)
{
    try { await test.Run(); Console.WriteLine($"PASS {test.Name}"); }
    catch (Exception exception)
    {
        failed++;
        Console.Error.WriteLine($"FAIL {test.Name}: {exception.Message}");
    }
}
Console.WriteLine($"WindowsClient tests: {tests.Length - failed} passed, {failed} failed");
return failed == 0 ? 0 : 1;

static Task SecurityCodeVector()
{
    string code = NativeSecurity.ComputeSecurityCode("production",
        "0123456789abcdef0123456789abcdef", new string('a', 64),
        "11111111-2222-3333-4444-555555555555", new string('b', 64),
        new string('c', 32));
    Assert(code == "5681 8092", "Security code does not match the protocol vector.");
    return Task.CompletedTask;
}

static Task ConfirmationProofVector()
{
    string proof = NativeSecurity.ComputeConfirmationProof(new string('d', 64),
        new string('c', 32), new string('b', 64));
    Assert(proof == "84eeb362e92a5f153a21acbc835d3d7f6b10223563fe58f7d7f85016e6c1d942",
        "Confirmation proof does not match the protocol vector.");
    return Task.CompletedTask;
}

static Task ManualAddressValidation()
{
    Assert(DiscoveryClient.TryParseManualAddress("192.168.1.24:9443", 8443,
        out string address, out int port) && address == "192.168.1.24" && port == 9443,
        "Private IPv4 address was rejected.");
    Assert(!DiscoveryClient.TryParseManualAddress("8.8.8.8", 8443, out _, out _),
        "Public address was accepted.");
    Assert(!DiscoveryClient.TryParseManualAddress("127.0.0.1", 8443, out _, out _),
        "Loopback address was accepted.");
    Assert(!DiscoveryClient.TryParseManualAddress("https://example.com", 8443,
        out _, out _), "DNS host was accepted.");
    return Task.CompletedTask;
}

static Task DiscoverySourceAddress()
{
    byte[] packet = Encoding.UTF8.GetBytes("""
        {"type":"lmt-discovery-response","version":2,
         "serverId":"server-a","name":"Office PC","environment":"production",
         "httpsPort":8443,"certificateFingerprint":"ignored-address-field",
         "capabilities":{"nativeWindowsTransfer":{"version":1,"pairingAvailable":true}}}
        """);
    DiscoveredReceiver? receiver = DiscoveryClient.ParseResponse(packet,
        IPAddress.Parse("10.1.2.3"), "production");
    Assert(receiver?.Address == "10.1.2.3", "Packet source was not used as endpoint.");
    Assert(receiver?.NativeWindows?.PairingAvailable == true, "Capability was not parsed.");
    Assert(DiscoveryClient.ParseResponse(packet, IPAddress.Parse("203.0.113.4"),
        "production") is null, "Public discovery response was accepted.");
    return Task.CompletedTask;
}

static Task TransferSourceValidation()
{
    string root = CreateTestRoot();
    try
    {
        string path = Path.Combine(root, "sample.bin");
        File.WriteAllBytes(path, [1, 2, 3]);
        string session = "win-" + new string('a', 32);
        IReadOnlyList<TransferSource> first = NativeTransferClient.PrepareFiles([path], session);
        Assert(first.Count == 1 && first[0].FileId.StartsWith(session + "-"),
            "File ID is not scoped to the client session.");
        string empty = Path.Combine(root, "empty.bin");
        File.WriteAllBytes(empty, []);
        AssertThrows<NativeClientException>(() =>
            NativeTransferClient.PrepareFiles([empty], session));
    }
    finally { SafeDelete(root); }
    return Task.CompletedTask;
}

static Task RetryClassification()
{
    Assert(NativeTransferClient.IsRetryableStatus(HttpStatusCode.ServiceUnavailable),
        "503 must be retryable.");
    Assert(NativeTransferClient.IsRetryableStatus(HttpStatusCode.TooManyRequests),
        "429 must be retryable.");
    Assert(!NativeTransferClient.IsRetryableStatus(HttpStatusCode.Unauthorized),
        "401 must not be retried as a network failure.");
    Assert(!NativeTransferClient.IsRetryableStatus(HttpStatusCode.Conflict),
        "409 must not be retried generically.");
    Assert(NativeTransferClient.IsSessionFatal(new NativeClientException(
        "Unauthorized", "Rejected", statusCode: HttpStatusCode.Unauthorized)),
        "Authentication failure must end the transfer session.");
    Assert(!NativeTransferClient.IsSessionFatal(new NativeClientException(
        "filename_conflict", "Conflict", statusCode: HttpStatusCode.Conflict)),
        "Filename conflict must remain a per-file result.");
    return Task.CompletedTask;
}

static Task InvalidCertificatePin()
{
    AssertThrows<ArgumentException>(() => NativeSecurity.CreatePinnedClient(
        new Uri("https://192.168.1.20:8443"), new string('z', 64)));
    return Task.CompletedTask;
}

static async Task InvalidApprovalIdentifiers()
{
    using var client = new HttpClient(new StubHandler(new HttpResponseMessage(
        HttpStatusCode.Accepted)
    {
        Content = new StringContent("{\"requestId\":\"short\",\"transferId\":\"short\"}",
            Encoding.UTF8, "application/json")
    })) { BaseAddress = new Uri("https://192.168.1.20:8443") };
    var receiver = new TrustedReceiver("server", "Receiver", "test", "192.168.1.20",
        8443, new string('a', 64), new string('b', 64), DateTimeOffset.UtcNow);
    var source = new TransferSource("win-" + new string('c', 32) + "-file",
        "unused", "sample.bin", 1);
    try
    {
        await NativeTransferAuthorization.RequestApprovalAsync(client, receiver,
            "win-" + new string('c', 32), [source], true, CancellationToken.None);
    }
    catch (NativeClientException exception) when (exception.Code == "invalid_server_response")
    {
        return;
    }
    throw new InvalidOperationException("Invalid approval IDs did not produce a typed error.");
}

static Task TrustPersistence()
{
    string root = CreateTestRoot();
    try
    {
        var store = new TrustedReceiverStore(root, "test");
        var receiver = new TrustedReceiver("server", "Receiver", "test", "10.0.0.2",
            18443, new string('a', 64), new string('b', 64), DateTimeOffset.UtcNow);
        store.Upsert(receiver);
        TrustedReceiver loaded = store.Load().Single();
        Assert(loaded.Credential == receiver.Credential, "DPAPI credential did not round-trip.");
        string json = Directory.GetFiles(root, "trusted-windows-receivers.json").Single();
        Assert(!File.ReadAllText(json).Contains(receiver.Credential, StringComparison.Ordinal),
            "Credential was stored in plaintext.");
        File.WriteAllText(json, "{not-json");
        AssertThrows<NativeClientException>(() => store.Load());
    }
    finally { SafeDelete(root); }
    return Task.CompletedTask;
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
    for (int attempt = 0; attempt < 4; attempt++)
    {
        try { if (Directory.Exists(resolved)) Directory.Delete(resolved, true); return; }
        catch (IOException) when (attempt < 3) { Thread.Sleep(50); }
    }
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

sealed class StubHandler(HttpResponseMessage response) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
        CancellationToken cancellationToken) => Task.FromResult(response);
}
