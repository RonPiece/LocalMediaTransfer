using System.Net;
using System.Text;
using LocalMediaTransfer.WindowsClient;

var tests = new (string Name, Func<Task> Run)[]
{
    ("security code test vector", SecurityCodeVector),
    ("chunk capacity bounds file size", ChunkCapacity),
    ("confirmation proof test vector", ConfirmationProofVector),
    ("manual address validation", ManualAddressValidation),
    ("discovery uses packet source address", DiscoverySourceAddress),
    ("discovery skips virtual adapters and shares physical scan budget", DiscoveryAdapterSelection),
    ("transfer source limits and stable IDs", TransferSourceValidation),
    ("maximum native selection uses bounded cancellable workers", BoundedNativeSelection),
    ("retry classification", RetryClassification),
    ("invalid certificate pins fail before transport", InvalidCertificatePin),
    ("pinned TLS stalled body cancels", () => PinnedNetworkCancellation.RunAsync(false)),
    ("pinned TLS trickling body cancels", () => PinnedNetworkCancellation.RunAsync(true)),
    ("invalid approval identifiers are typed errors", InvalidApprovalIdentifiers),
    ("authenticated unpair request", AuthenticatedUnpairRequest),
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

static Task ChunkCapacity()
{
    Assert(NativeTransferClient.MaximumFileBytes(8 * 1024 * 1024) == 83_886_080_000L,
        "Native chunk capacity is incorrect.");
    Assert(NativeTransferClient.MaximumFileBytes(4 * 1024 * 1024) == 41_943_040_000L,
        "Compatibility chunk capacity is incorrect.");
    Assert(NativeTransferClient.MaximumFileBytes(16 * 1024 * 1024) == 100L * 1024 * 1024 * 1024,
        "Server byte limit must also apply.");
    return Task.CompletedTask;
}

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

static Task DiscoveryAdapterSelection()
{
    Assert(!DiscoveryClient.ShouldScanInterface(
        System.Net.NetworkInformation.NetworkInterfaceType.Ethernet,
        "Tailscale", "Tailscale Tunnel"),
        "Named virtual adapter was eligible for LAN discovery.");
    Assert(DiscoveryClient.ShouldScanInterface(
        System.Net.NetworkInformation.NetworkInterfaceType.Wireless80211,
        "Wi-Fi", "Physical wireless adapter"),
        "Physical Wi-Fi adapter was excluded from LAN discovery.");

    var destinations = DiscoveryClient.EnumerateDestinations([
        new DiscoveryClient.DiscoverySubnet(
            IPAddress.Parse("169.254.83.107"), IPAddress.Parse("255.255.0.0"),
            System.Net.NetworkInformation.NetworkInterfaceType.Ethernet,
            "Tailscale", "Tailscale Tunnel", false),
        new DiscoveryClient.DiscoverySubnet(
            IPAddress.Parse("192.168.50.20"), IPAddress.Parse("255.255.255.0"),
            System.Net.NetworkInformation.NetworkInterfaceType.Wireless80211,
            "Wi-Fi", "Physical wireless adapter", true),
        new DiscoveryClient.DiscoverySubnet(
            IPAddress.Parse("10.10.10.20"), IPAddress.Parse("255.255.255.0"),
            System.Net.NetworkInformation.NetworkInterfaceType.Ethernet,
            "Ethernet", "Physical ethernet adapter", true)
    ]);
    Assert(destinations.Any(address => address.ToString().StartsWith("192.168.50.")),
        "Wi-Fi subnet was not scanned.");
    Assert(destinations.Any(address => address.ToString().StartsWith("10.10.10.")),
        "Ethernet subnet was starved by the shared discovery cap.");
    Assert(destinations.All(address => !address.ToString().StartsWith("169.254.")),
        "Excluded virtual subnet consumed discovery destinations.");
    Assert(destinations.Count <= 1024, "Discovery exceeded its global safety cap.");
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

static async Task BoundedNativeSelection()
{
    string root = CreateTestRoot();
    try
    {
        string[] paths = Enumerable.Range(0, 1_000).Select(index =>
            Path.Combine(root, $"file-{index:D4}.bin")).ToArray();
        foreach (string path in paths) File.WriteAllBytes(path, [1]);
        string session = "win-" + new string('d', 32);
        Assert(NativeTransferClient.PrepareFiles(paths, session).Count == 1_000,
            "Maximum supported selection was rejected.");
        AssertThrows<NativeClientException>(() => NativeTransferClient.PrepareFiles(
            paths.Concat([Path.Combine(root, "extra.bin")]), session));

        int active = 0, peak = 0, completed = 0;
        var selected = Enumerable.Range(0, 1_000).ToArray();
        await BoundedWorkerPool.RunAsync(selected, 6, async (_, _, token) =>
        {
            int count = Interlocked.Increment(ref active);
            lock (selected) peak = Math.Max(peak, count);
            try
            {
                await Task.Delay(1, token);
                Interlocked.Increment(ref completed);
            }
            finally { Interlocked.Decrement(ref active); }
        }, _ => true, CancellationToken.None);
        Assert(completed == 1_000 && peak <= 6,
            "Maximum selection exceeded six active workers or lost work.");

        using var cancel = new CancellationTokenSource();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        int dispatched = 0;
        Task run = BoundedWorkerPool.RunAsync(selected, 6, async (_, _, token) =>
        {
            if (Interlocked.Increment(ref dispatched) == 6) started.TrySetResult();
            await Task.Delay(Timeout.Infinite, token);
        }, _ => false, cancel.Token);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cancel.Cancel();
        try
        {
            await run.WaitAsync(TimeSpan.FromSeconds(5));
            throw new InvalidOperationException("Cancelled worker pool completed successfully.");
        }
        catch (OperationCanceledException) { }
        Assert(dispatched <= 6, "Cancellation still dispatched unbounded work.");
    }
    finally { SafeDelete(root); }
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

static async Task AuthenticatedUnpairRequest()
{
    var receiver = new TrustedReceiver("server", "Receiver", "test", "192.168.1.20",
        8443, new string('a', 64), new string('b', 64), DateTimeOffset.UtcNow);
    HttpMethod? observedMethod = null;
    string? observedPath = null;
    string? observedCredential = null;
    using (var client = new HttpClient(new CallbackHandler(request =>
    {
        observedMethod = request.Method;
        observedPath = request.RequestUri?.AbsolutePath;
        observedCredential = request.Headers.TryGetValues(
            "X-Device-Credential", out var values) ? values.Single() : null;
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"ok\":true,\"status\":\"unpaired\"}",
                Encoding.UTF8, "application/json")
        };
    })) { BaseAddress = receiver.HttpsBaseUri })
    {
        Assert(await PairingClient.UnpairWithClientAsync(client, receiver,
            CancellationToken.None), "Successful remote unpair was not reported.");
    }
    Assert(observedMethod == HttpMethod.Delete &&
        observedPath == "/native/v1/devices/current",
        "Unpair did not use the scoped DELETE endpoint.");
    Assert(observedCredential == receiver.Credential,
        "Unpair did not authenticate with the trusted-device credential.");

    using var rejectedClient = new HttpClient(new CallbackHandler(_ =>
        new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("{\"error\":\"credential_rejected\"}",
                Encoding.UTF8, "application/json")
        })) { BaseAddress = receiver.HttpsBaseUri };
    Assert(!await PairingClient.UnpairWithClientAsync(rejectedClient, receiver,
        CancellationToken.None),
        "An already-revoked credential was not treated as remotely absent.");
    using var malformedClient = new HttpClient(new CallbackHandler(_ =>
        new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        })) { BaseAddress = receiver.HttpsBaseUri };
    try
    {
        await PairingClient.UnpairWithClientAsync(malformedClient, receiver, CancellationToken.None);
        throw new InvalidOperationException("Missing unpair acknowledgement was accepted.");
    }
    catch (NativeClientException exception) when (exception.Code == "invalid_server_response") { }
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

sealed class CallbackHandler(
    Func<HttpRequestMessage, HttpResponseMessage> callback) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
        CancellationToken cancellationToken) => Task.FromResult(callback(request));
}
