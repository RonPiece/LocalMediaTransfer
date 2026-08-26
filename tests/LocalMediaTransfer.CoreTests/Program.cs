using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Features.Dashboard;
using LocalMediaTransfer.GUI.Features.Settings;
using LocalMediaTransfer.GUI.Features.Send;
using LocalMediaTransfer.GUI.Services;

internal static class Program
{
    private static readonly List<(string Name, Func<Task> Test)> Tests =
    [
        ("owned process stops normally", OwnedProcessStopsNormally),
        ("external conflict remains alive", ExternalConflictRemainsAlive),
        ("conflict never reports running", ConflictNeverReportsRunning),
        ("unverified conflict cannot be recovered", UnverifiedConflictCannotBeRecovered),
        ("active verified owner cannot be recovered", ActiveVerifiedOwnerCannotBeRecovered),
        ("verified stale owner uses authenticated graceful shutdown", VerifiedStaleOwnerUsesAuthenticatedShutdown),
        ("changed ownership proof blocks recovery", ChangedOwnershipProofBlocksRecovery),
        ("ownership protocol rejects tampering", OwnershipProtocolRejectsTampering),
        ("control credential is persistent and environment-bound", ControlCredentialIsPersistentAndEnvironmentBound),
        ("disposal never kills unowned process", DisposalNeverKillsUnownedProcess),
        ("application environments isolate desktop resources", ApplicationEnvironmentsIsolateDesktopResources),
        ("test data override is confined to the isolated temp root", TestDataOverrideIsConfined),
        ("server launch carries environment identity", ServerLaunchCarriesEnvironmentIdentity),
        ("control credential uses stdin and not command line", ControlCredentialUsesStdin),
        ("incomplete ownership launch metadata fails closed", IncompleteOwnershipLaunchFailsClosed),
        ("server output redacts session credentials", ServerOutputRedactsSessionCredentials),
        ("cancelled monitor leaves replacement process alone", CancelledMonitorLeavesReplacementAlone),
        ("closing owned lifetime job terminates child process", ClosingLifetimeJobTerminatesChild),
        ("system process wrapper owns child lifetime", SystemProcessWrapperOwnsChildLifetime),
        ("pipe reads messages larger than 4 KB", PipeReadsLargeMessage),
        ("pipe serializes concurrent writes", PipeSerializesConcurrentWrites),
        ("pipe reconnects without false duplicate transitions", PipeReconnects),
        ("stopped pipe loop cannot disconnect replacement", StoppedPipeLoopCannotDisconnectReplacement),
        ("pipe reports malformed JSON", PipeReportsMalformedJson),
        ("pipe parser maps metrics message", PipeParserMapsMetricsMessage),
        ("pipe parser rejects malformed JSON", PipeParserRejectsMalformedJson),
        ("pipe session proof rejects tampering", PipeSessionProofRejectsTampering),
        ("acknowledged pipe commands report delivery", AcknowledgedPipeCommandsReportDelivery),
        ("disconnected security commands fail closed", DisconnectedSecurityCommandsFailClosed),
        ("reconnect reconciliation reapplies security policy", ReconnectReconciliationReappliesSecurityPolicy),
        ("pipe parser rejects unsafe telemetry", PipeParserRejectsUnsafeTelemetry),
        ("pipe parser bounds native approval summaries", PipeParserBoundsNativeApprovals),
        ("secret redactor covers diagnostic forms", SecretRedactorCoversDiagnosticForms),
        ("shell launcher rejects unsafe schemes", ShellLauncherRejectsUnsafeSchemes),
        ("pipe disposal during IO is safe", PipeDisposalDuringIoIsSafe),
        ("network log service deduplicates repeated messages", NetworkLogServiceDeduplicates),
        ("dashboard presentation maps transfer history", DashboardPresentationMapsHistory),
        ("dashboard pairing payload includes trust fields", DashboardPairingPayloadIncludesTrustFields),
        ("browser transfer timer uses a bounded five-minute lifetime", BrowserTransferTimerUsesFiveMinutes),
        ("responsive layout preserves desktop density and narrow fallbacks", ResponsiveLayoutPreservesDesktopDensity),
        ("send state machine gates file selection and sending", SendStateMachineGatesActions),
        ("TLS metadata missing certificate is empty", TlsMetadataMissingCertificateIsEmpty),
        ("settings toggle decisions require confirmation only when enabling risky features", SettingsToggleDecisionsRequireConfirmation)
    ];

    public static async Task<int> Main()
    {
        int failures = 0;
        foreach (var (name, test) in Tests)
        {
            try
            {
                await test();
                Console.WriteLine($"[PASS] {name}");
            }
            catch (Exception ex)
            {
                failures++;
                Console.WriteLine($"[FAIL] {name}: {ex.Message}");
            }
        }

        Console.WriteLine($"{Tests.Count - failures}/{Tests.Count} C# core tests passed.");
        return failures == 0 ? 0 : 1;
    }

    private static async Task OwnedProcessStopsNormally()
    {
        var owned = new FakeServerProcess();
        using var manager = CreateManager(new FakeFactory(owned));
        manager.Start();
        await WaitForState(manager, ServerManagerState.Running);
        await manager.StopAsync();
        Assert(owned.Killed, "Owned process was not killed.");
        Assert(manager.State == ServerManagerState.Stopped, "Manager did not stop.");
    }

    private static async Task ExternalConflictRemainsAlive()
    {
        var conflictProbe = new FakeServerProcess(hasExited: true, exitCode: 2);
        using var manager = CreateManager(new FakeFactory(conflictProbe));
        manager.Start();
        await WaitForState(manager, ServerManagerState.Conflict);
        await manager.StopAsync();
        Assert(manager.State == ServerManagerState.Stopped, "Manager did not stop cleanly.");
    }

    private static async Task ConflictNeverReportsRunning()
    {
        var states = new ConcurrentQueue<ServerManagerState>();
        using var manager = CreateManager(
            new FakeFactory(new FakeServerProcess(hasExited: true, exitCode: 2)));
        manager.StateChanged += states.Enqueue;
        manager.Start();
        await WaitForState(manager, ServerManagerState.Conflict);
        Assert(!states.Contains(ServerManagerState.Running), "Conflict was reported as Running.");
    }

    private static async Task UnverifiedConflictCannotBeRecovered()
    {
        var conflictProbe = new FakeServerProcess(hasExited: true, exitCode: 2);
        var ownership = new FakeOwnershipClient(new(
            ServerOwnershipStatus.Unverified,
            null,
            "No authenticated proof."));
        using var manager = CreateManager(
            new FakeFactory(conflictProbe),
            ownershipClient: ownership);
        manager.Start();
        await WaitForState(manager, ServerManagerState.Conflict);

        ServerOwnershipInspection inspection = await manager.InspectConflictAsync();
        bool stopped = await manager.RecoverVerifiedConflictAsync(inspection);
        Assert(!stopped, "An unverified process was accepted for recovery.");
        Assert(ownership.ShutdownCalls == 0, "An unverified process received a shutdown request.");
        Assert(manager.State == ServerManagerState.Conflict, "Recovery hid the unresolved conflict.");
    }

    private static async Task ActiveVerifiedOwnerCannotBeRecovered()
    {
        var conflictProbe = new FakeServerProcess(hasExited: true, exitCode: 2);
        var ownership = new FakeOwnershipClient(new(
            ServerOwnershipStatus.ActiveOwner,
            CreateTestProof(),
            "The owner is active."));
        using var manager = CreateManager(
            new FakeFactory(conflictProbe),
            ownershipClient: ownership);
        manager.Start();
        await WaitForState(manager, ServerManagerState.Conflict);

        ServerOwnershipInspection inspection = await manager.InspectConflictAsync();
        bool stopped = await manager.RecoverVerifiedConflictAsync(inspection);
        Assert(!stopped, "A server with an active owner was accepted for recovery.");
        Assert(ownership.ShutdownCalls == 0, "An active owner's server received a shutdown request.");
        Assert(manager.State == ServerManagerState.Conflict, "Active ownership conflict was hidden.");
    }

    private static async Task VerifiedStaleOwnerUsesAuthenticatedShutdown()
    {
        var conflictProbe = new FakeServerProcess(hasExited: true, exitCode: 2);
        var replacement = new FakeServerProcess();
        var inspection = new ServerOwnershipInspection(
            ServerOwnershipStatus.VerifiedStaleOwner,
            CreateTestProof(),
            "The authenticated owner is stale.");
        var ownership = new FakeOwnershipClient(inspection, shutdownResult: true);
        using var manager = CreateManager(
            new FakeFactory(conflictProbe, replacement),
            ownershipClient: ownership);
        manager.Start();
        await WaitForState(manager, ServerManagerState.Conflict);

        ServerOwnershipInspection actual = await manager.InspectConflictAsync();
        bool recovered = await manager.RecoverVerifiedConflictAsync(actual);
        await WaitForState(manager, ServerManagerState.Running);

        Assert(recovered, "Authenticated stale-owner recovery failed.");
        Assert(ownership.ShutdownCalls == 1, "Recovery did not use exactly one authenticated shutdown.");
        Assert(replacement.Started, "A replacement owned server was not started.");
    }

    private static async Task ChangedOwnershipProofBlocksRecovery()
    {
        var conflictProbe = new FakeServerProcess(hasExited: true, exitCode: 2);
        var inspection = new ServerOwnershipInspection(
            ServerOwnershipStatus.VerifiedStaleOwner,
            CreateTestProof(),
            "The authenticated owner is stale.");
        var ownership = new FakeOwnershipClient(inspection, shutdownResult: false);
        using var manager = CreateManager(
            new FakeFactory(conflictProbe),
            ownershipClient: ownership);
        manager.Start();
        await WaitForState(manager, ServerManagerState.Conflict);

        bool recovered = await manager.RecoverVerifiedConflictAsync(
            await manager.InspectConflictAsync());
        Assert(!recovered, "Recovery succeeded after the ownership proof changed.");
        Assert(ownership.ShutdownCalls == 1, "The authenticated shutdown path was not consulted.");
        Assert(manager.State == ServerManagerState.Conflict, "Failed recovery did not preserve the conflict state.");
    }

    private static Task OwnershipProtocolRejectsTampering()
    {
        byte[] key = Enumerable.Range(0, 32).Select(value => (byte)value).ToArray();
        const string clientNonce = "00112233445566778899aabbccddeeff";
        ServerOwnershipProof proof = CreateTestProof(key, clientNonce);

        Assert(ServerOwnershipProtocol.VerifyProof(proof, key, clientNonce),
            "A valid ownership proof was rejected.");
        Assert(!ServerOwnershipProtocol.VerifyProof(
                proof with { ServerProcessId = proof.ServerProcessId + 1 },
                key,
                clientNonce),
            "A proof with a changed PID was accepted.");
        Assert(!ServerOwnershipProtocol.VerifyProof(
                proof with { ServerProcessStartTimeUtcFileTime = proof.ServerProcessStartTimeUtcFileTime + 1 },
                key,
                clientNonce),
            "A proof with a changed process creation time was accepted.");
        Assert(!ServerOwnershipProtocol.VerifyProof(
                proof with { Environment = "production" },
                key,
                clientNonce),
            "A proof with a changed environment was accepted.");
        Assert(!ServerOwnershipProtocol.VerifyProof(
                proof with { PipeName = "wrong-pipe" },
                key,
                clientNonce),
            "A proof with a changed control endpoint was accepted.");
        Assert(!ServerOwnershipProtocol.VerifyProof(
                proof,
                RandomNumberGenerator.GetBytes(32),
                clientNonce),
            "A proof signed with another credential was accepted.");
        Assert(!ServerOwnershipProtocol.VerifyProof(
                proof,
                key,
                "ffeeddccbbaa99887766554433221100"),
            "A proof was accepted for another client challenge.");
        return Task.CompletedTask;
    }

    private static Task ControlCredentialIsPersistentAndEnvironmentBound()
    {
        string root = Path.Combine(
            Path.GetTempPath(),
            "LocalMediaTransfer.Tests",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            byte[] first = ServerControlCredentialStore.LoadOrCreate(root, "test");
            byte[] second = ServerControlCredentialStore.LoadOrCreate(root, "test");
            try
            {
                Assert(first.Length == 32, "The control credential is not 256 bits.");
                Assert(CryptographicOperations.FixedTimeEquals(first, second),
                    "The protected control credential did not persist.");
                AssertThrows<System.ComponentModel.Win32Exception>(
                    () => ServerControlCredentialStore.LoadOrCreate(root, "production"),
                    "A credential protected for the test environment was reused in production.");
            }
            finally
            {
                CryptographicOperations.ZeroMemory(first);
                CryptographicOperations.ZeroMemory(second);
            }
        }
        finally
        {
            string allowedRoot = Path.GetFullPath(Path.Combine(
                Path.GetTempPath(),
                "LocalMediaTransfer.Tests"));
            string resolvedRoot = Path.GetFullPath(root);
            Assert(resolvedRoot.StartsWith(
                allowedRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase),
                "Credential-test cleanup escaped the isolated test root.");
            Directory.Delete(resolvedRoot, recursive: true);
        }

        return Task.CompletedTask;
    }

    private static Task ApplicationEnvironmentsIsolateDesktopResources()
    {
        var production = ApplicationEnvironment.Production;
        var test = ApplicationEnvironment.Test;

        Assert(production.Name == "production", "Production identity is wrong.");
        Assert(test.Name == "test", "Test identity is wrong.");
        Assert(test.IsTest, "Test profile is not visibly marked as test.");
        Assert(production.GuiMutexName != test.GuiMutexName, "GUI mutex is shared.");
        Assert(production.PipeName != test.PipeName, "Named pipe is shared.");
        Assert(production.HttpsPort != test.HttpsPort, "HTTPS port is shared.");
        Assert(production.HttpPort != test.HttpPort, "HTTP port is shared.");
        Assert(production.DataRoot != test.DataRoot, "Application data root is shared.");
        Assert(production.SettingsPath != test.SettingsPath, "Settings file is shared.");
        Assert(production.TlsStorageDirectory != test.TlsStorageDirectory, "TLS storage is shared.");
        Assert(!test.DefaultUploadDirectory.StartsWith(
            Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
            StringComparison.OrdinalIgnoreCase), "Test uploads default to Pictures.");
        Assert(test.DefaultUploadDirectory.StartsWith(
            test.DataRoot,
            StringComparison.OrdinalIgnoreCase), "Test uploads escape the test data root.");
        return Task.CompletedTask;
    }

    private static async Task ServerLaunchCarriesEnvironmentIdentity()
    {
        var process = new FakeServerProcess();
        var factory = new FakeFactory(process);
        using var manager = CreateManager(factory, ApplicationEnvironment.Test);
        manager.Start();
        await WaitForState(manager, ServerManagerState.Running);

        var options = factory.LastOptions ?? throw new InvalidOperationException("Launch options were not captured.");
        Assert(options.EnvironmentName == "test", "Test environment was not passed to the server.");
        Assert(options.Port == 18443, "Test HTTPS port was not selected.");
        Assert(options.HttpPort == 18080, "Test HTTP port was not selected.");
        Assert(options.TlsStorageDirectory == ApplicationEnvironment.Test.TlsStorageDirectory, "Test TLS root was not selected.");
        Assert(options.DataRootDirectory == ApplicationEnvironment.Test.DataRoot, "Test data root was not passed to the server.");
        Assert(options.ControlToken?.Length == 64, "The server did not receive a 256-bit control credential through stdin.");
        Assert(options.OwnerProcessId > 0, "The exact GUI owner PID was not passed.");
        Assert(options.OwnerProcessStartTimeUtcFileTime > 0, "The exact GUI creation time was not passed.");
        Assert(options.ControlInstanceId?.Length == 32, "The launch instance identifier is missing.");
    }

    private static async Task ServerOutputRedactsSessionCredentials()
    {
        var process = new FakeServerProcess();
        using var manager = CreateManager(new FakeFactory(process));
        var logs = new List<string>();
        manager.ServerLogReceived += logs.Add;
        manager.Start();
        await WaitForState(manager, ServerManagerState.Running);

        process.EmitOutput(
            "Phone (Wi-Fi): https://192.0.2.10:8443/?token=super-secret-token");

        Assert(logs.Any(log => log.Contains("?token=[redacted]", StringComparison.Ordinal)),
            "The connection URL was not retained with a redacted credential.");
        Assert(logs.All(log => !log.Contains("super-secret-token", StringComparison.Ordinal)),
            "A server session credential entered the GUI network log.");
    }

    private static Task ControlCredentialUsesStdin()
    {
        string token = new('a', 64);
        var options = new ServerLaunchOptions(
            "fake-server.exe",
            8443,
            Path.GetTempPath(),
            FilenameConflictPolicy.KeepBoth,
            ControlToken: token,
            OwnerProcessId: 123,
            OwnerProcessStartTimeUtcFileTime: 456,
            ControlInstanceId: "0123456789abcdef0123456789abcdef");
        using var process = (SystemServerProcess)new SystemServerProcessFactory().Create(options);
        Assert(process.StartInfo.RedirectStandardInput,
            "The control credential channel does not use redirected stdin.");
        Assert(!process.StartInfo.ArgumentList.Contains(token),
            "The control credential was exposed in the process command line.");
        Assert(process.StartInfo.ArgumentList.Contains("--control-token-stdin"),
            "The child was not told to read its control credential from stdin.");
        return Task.CompletedTask;
    }

    private static Task IncompleteOwnershipLaunchFailsClosed()
    {
        var options = new ServerLaunchOptions(
            "fake-server.exe",
            8443,
            Path.GetTempPath(),
            FilenameConflictPolicy.KeepBoth,
            ControlToken: new string('a', 64));
        AssertThrows<ArgumentException>(
            () => new SystemServerProcessFactory().Create(options),
            "The launcher accepted a key without exact owner metadata.");
        return Task.CompletedTask;
    }

    private static Task TestDataOverrideIsConfined()
    {
        const string variableName = "LMT_TEST_DATA_ROOT";
        string? previous = Environment.GetEnvironmentVariable(variableName);
        try
        {
            string allowed = Path.Combine(
                Path.GetTempPath(),
                "LocalMediaTransfer.Tests",
                Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(variableName, allowed);
            Assert(
                ApplicationEnvironment.Test.DataRoot == Path.GetFullPath(allowed),
                "An isolated test root override was not accepted.");
            Assert(
                ApplicationEnvironment.Production.DataRoot != Path.GetFullPath(allowed),
                "The test-only override changed the production root.");

            string outside = Path.Combine(
                Path.GetTempPath(),
                "LocalMediaTransfer.NotTests",
                Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(variableName, outside);
            AssertThrows<InvalidOperationException>(
                () => _ = ApplicationEnvironment.Test.DataRoot,
                "A test root outside LocalMediaTransfer.Tests was accepted.");
        }
        finally
        {
            Environment.SetEnvironmentVariable(variableName, previous);
        }

        return Task.CompletedTask;
    }

    private static async Task DisposalNeverKillsUnownedProcess()
    {
        var manager = CreateManager(
            new FakeFactory(new FakeServerProcess(hasExited: true, exitCode: 2)));
        manager.Start();
        await WaitForState(manager, ServerManagerState.Conflict);
        manager.Dispose();
        Assert(manager.State == ServerManagerState.Stopped, "Dispose did not stop the manager.");
    }

    private static async Task CancelledMonitorLeavesReplacementAlone()
    {
        var first = new FakeServerProcess();
        var replacement = new FakeServerProcess();
        using var manager = CreateManager(
            new FakeFactory(first, replacement));

        manager.Start();
        await WaitForState(manager, ServerManagerState.Running);
        await manager.StopAsync();
        manager.Start();
        await WaitForState(manager, ServerManagerState.Running);
        await Task.Delay(100);

        Assert(first.Killed, "The first owned process was not stopped.");
        Assert(!replacement.Killed, "A cancelled monitor killed the replacement process.");
    }

    private static async Task ClosingLifetimeJobTerminatesChild()
    {
        using var child = Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -Command \"Start-Sleep -Seconds 30\"",
            UseShellExecute = false,
            CreateNoWindow = true
        }) ?? throw new InvalidOperationException("Could not start lifetime-job test process.");

        try
        {
            using (ProcessLifetimeJob.CreateFor(child))
            {
                Assert(!child.HasExited, "Test child exited before the job handle was closed.");
            }

            await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Assert(child.HasExited, "Closing the lifetime job did not terminate its child.");
        }
        finally
        {
            if (!child.HasExited)
            {
                child.Kill(entireProcessTree: true);
                await child.WaitForExitAsync();
            }
        }
    }

    private static async Task SystemProcessWrapperOwnsChildLifetime()
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Start-Sleep -Seconds 30\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };
        var wrapper = new SystemServerProcess(process, captureOutput: true);
        int processId = 0;
        try
        {
            wrapper.Start();
            processId = wrapper.Id;
            Assert(!wrapper.HasExited, "Wrapped child exited during startup.");
            wrapper.Dispose();

            try
            {
                using Process observed = Process.GetProcessById(processId);
                await observed.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
                Assert(observed.HasExited, "Disposing the wrapper left its child running.");
            }
            catch (ArgumentException)
            {
                // The job may terminate the child before it can be reopened.
            }
        }
        finally
        {
            wrapper.Dispose();
            if (processId != 0)
            {
                try
                {
                    using Process remaining = Process.GetProcessById(processId);
                    if (!remaining.HasExited)
                    {
                        remaining.Kill(entireProcessTree: true);
                        await remaining.WaitForExitAsync();
                    }
                }
                catch (ArgumentException)
                {
                }
            }
        }
    }

    private static async Task PipeReadsLargeMessage()
    {
        string pipeName = UniquePipeName();
        using var server = CreateServer(pipeName);
        using var client = new PipeClient(pipeName, 25);
        var received = new TaskCompletionSource<LogData>(TaskCreationOptions.RunContinuationsAsynchronously);
        client.LogReceived += data => received.TrySetResult(data);

        Task connection = server.WaitForConnectionAsync();
        client.Start();
        await connection.WaitAsync(TimeSpan.FromSeconds(5));

        string text = new('x', 6000);
        await WritePipeMessage(server, JsonSerializer.Serialize(new
        {
            type = "log",
            data = new { level = "INFO", message = text, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }
        }));

        LogData result = await received.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert(result.Message.Length == 6000, "Large message was truncated.");
    }

    private static async Task PipeSerializesConcurrentWrites()
    {
        string pipeName = UniquePipeName();
        using var server = CreateServer(pipeName);
        using var client = new PipeClient(pipeName, 25);

        Task connection = server.WaitForConnectionAsync();
        client.Start();
        await connection.WaitAsync(TimeSpan.FromSeconds(5));
        await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));

        Task<string[]> reader = Task.Run(async () =>
        {
            var messages = new List<string>();
            for (int i = 0; i < 12; i++)
            {
                messages.Add(await ReadPipeMessage(server, CancellationToken.None));
            }
            return messages.ToArray();
        });

        await Task.WhenAll(Enumerable.Range(0, 12)
            .Select(i => client.SendCommandAsync("test", i.ToString())));
        string[] messages = await reader.WaitAsync(TimeSpan.FromSeconds(5));

        Assert(messages.Length == 12, "Not all concurrent commands were received.");
        foreach (string message in messages)
        {
            using JsonDocument document = JsonDocument.Parse(message);
            Assert(document.RootElement.GetProperty("type").GetString() == "test", "Interleaved JSON was received.");
        }
    }

    private static async Task PipeReconnects()
    {
        string pipeName = UniquePipeName();
        using var client = new PipeClient(pipeName, 25);
        var transitions = new ConcurrentQueue<bool>();
        client.ConnectionChanged += transitions.Enqueue;

        using (var first = CreateServer(pipeName))
        {
            Task connected = first.WaitForConnectionAsync();
            client.Start();
            await connected.WaitAsync(TimeSpan.FromSeconds(5));
            await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));
        }

        await WaitUntil(() => !client.IsConnected, TimeSpan.FromSeconds(5));

        using (var second = CreateServer(pipeName))
        {
            await second.WaitForConnectionAsync().WaitAsync(TimeSpan.FromSeconds(5));
            await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));
        }

        int connectedCount = transitions.Count(value => value);
        int disconnectedCount = transitions.Count(value => !value);
        Assert(connectedCount == 2, $"Expected 2 connected transitions, got {connectedCount}.");
        Assert(disconnectedCount >= 1, "Reconnect did not publish a disconnect transition.");
    }

    private static async Task StoppedPipeLoopCannotDisconnectReplacement()
    {
        string pipeName = UniquePipeName();
        using var client = new PipeClient(pipeName, 25);

        using (var first = CreateServer(pipeName))
        {
            Task connected = first.WaitForConnectionAsync();
            client.Start();
            await connected.WaitAsync(TimeSpan.FromSeconds(5));
            await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));
            client.Stop();
        }

        using var replacement = CreateServer(pipeName);
        Task replacementConnected = replacement.WaitForConnectionAsync();
        client.Start();
        await replacementConnected.WaitAsync(TimeSpan.FromSeconds(5));
        await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));
        await Task.Delay(100);

        Assert(client.IsConnected, "The stopped pipe loop disconnected the replacement.");
    }

    private static async Task PipeReportsMalformedJson()
    {
        string pipeName = UniquePipeName();
        using var server = CreateServer(pipeName);
        using var client = new PipeClient(pipeName, 25);
        var diagnostic = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        client.DiagnosticLog += message =>
        {
            if (message.Contains("malformed JSON", StringComparison.OrdinalIgnoreCase))
            {
                diagnostic.TrySetResult(message);
            }
        };

        Task connection = server.WaitForConnectionAsync();
        client.Start();
        await connection.WaitAsync(TimeSpan.FromSeconds(5));
        await WritePipeMessage(server, "{not-json");
        await diagnostic.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    private static Task PipeParserMapsMetricsMessage()
    {
        var result = PipeMessageParser.Parse(JsonSerializer.Serialize(new
        {
            type = "metrics",
            data = new
            {
                speedMBps = 12.5,
                speedAvailable = true,
                filesTransferred = 3,
                totalBytes = 1024,
                durationSeconds = 9,
                isActive = true
            }
        }));

        Assert(result.Success, "Metrics message did not parse.");
        Assert(result.Message?.Kind == PipeMessageKind.Metrics, "Metrics message kind was wrong.");
        var metrics = (MetricsData)result.Message!.Payload!;
        Assert(metrics.SpeedMBps == 12.5, "Metrics speed did not map.");
        Assert(metrics.SpeedAvailable, "Metrics availability did not map.");
        Assert(metrics.FilesTransferred == 3, "Metrics file count did not map.");
        Assert(metrics.IsActive, "Metrics active flag did not map.");
        return Task.CompletedTask;
    }

    private static Task PipeParserRejectsMalformedJson()
    {
        var result = PipeMessageParser.Parse("{not-json");
        Assert(!result.Success, "Malformed JSON was accepted.");
        Assert(
            result.Diagnostic?.Contains("malformed JSON", StringComparison.OrdinalIgnoreCase) == true,
            "Malformed JSON diagnostic was not specific.");
        return Task.CompletedTask;
    }

    private static async Task PipeDisposalDuringIoIsSafe()
    {
        string pipeName = UniquePipeName();
        using var server = CreateServer(pipeName);
        var client = new PipeClient(pipeName, 25);
        Task connection = server.WaitForConnectionAsync();
        client.Start();
        await connection.WaitAsync(TimeSpan.FromSeconds(5));
        await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));
        client.Dispose();
        Assert(!client.IsConnected, "Disposed client still reports connected.");
    }

    private static Task NetworkLogServiceDeduplicates()
    {
        var logs = new NetworkLogService();
        logs.Add("Lost connection to server");
        logs.Add("Lost connection to server");
        Assert(logs.Entries.Count == 1, "Repeated disconnect message was not deduplicated.");
        return Task.CompletedTask;
    }

    private static Task DashboardPresentationMapsHistory()
    {
        var items = DashboardPresentation.ToTransferItems([
            new TransferHistoryData
            {
                CompletedAt = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                SelectedFiles = 2,
                UploadedFiles = 1,
                SkippedFiles = 1,
                SelectedBytes = 2 * 1024 * 1024,
                SelectedMediaBytes = 1 * 1024 * 1024,
                AdditionalComponentsBytes = 1 * 1024 * 1024,
                SelectedMediaFiles = 1,
                AdditionalComponentsFiles = 1,
                UploadedBytes = 1 * 1024 * 1024,
                AverageSpeedMBps = 12.3,
                PeakSpeedMBps = 18.7
            }
        ]);

        Assert(items.Count == 1, "Dashboard history item was not produced.");
        Assert(items[0].Title == "2 files", "Dashboard transfer title is wrong.");
        Assert(items[0].Outcome == "1 uploaded · 1 skipped · 0 failed", "Dashboard outcome text is wrong.");
        Assert(
            items[0].ContentBreakdown == "1.0 MB selected media · +1.0 MB in 1 additional component · 2.0 MB total content",
            "Dashboard content breakdown is wrong.");
        Assert(items[0].UploadedSize == "1.0 MB", "Dashboard uploaded-size formatting is wrong.");
        Assert(items[0].AverageSpeed == "Average 12.3 MB/s", "Dashboard average speed formatting is wrong.");
        Assert(items[0].PeakSpeed == "Peak 18.7 MB/s", "Dashboard peak speed formatting is wrong.");
        return Task.CompletedTask;
    }

    private static Task DashboardPairingPayloadIncludesTrustFields()
    {
        var payload = DashboardPresentation.BuildPairingPayload(
            "server-1",
            "DESKTOP",
            "https://10.0.0.2:8443",
            "abcdef",
            "token123",
            "production");

        Assert((string)payload["type"]! == "lmt-pair", "Pairing payload type is wrong.");
        Assert((int)payload["version"]! == 3, "Pairing payload version is wrong.");
        Assert((string)payload["environment"]! == "production", "Pairing payload environment is missing.");
        Assert((string)payload["serverId"]! == "server-1", "Pairing payload server ID is missing.");
        Assert((string)payload["httpsUrl"]! == "https://10.0.0.2:8443", "Pairing payload HTTPS URL is missing.");
        Assert((string)payload["certificateFingerprint"]! == "abcdef", "Pairing payload fingerprint is missing.");
        Assert((string)payload["token"]! == "token123", "Pairing payload token is missing.");
        return Task.CompletedTask;
    }

    private static Task TlsMetadataMissingCertificateIsEmpty()
    {
        string missingDirectory = Path.Combine(Path.GetTempPath(), "LocalMediaTransfer.Tests", Guid.NewGuid().ToString("N"));
        var metadata = ServerTlsMetadataService.TryRead(missingDirectory);
        Assert(metadata == null, "Missing TLS certificate returned metadata.");
        return Task.CompletedTask;
    }

    private static Task PipeSessionProofRejectsTampering()
    {
        byte[] key = Enumerable.Range(1, 32).Select(value => (byte)value).ToArray();
        var expectation = new PipeSessionExpectation(
            2200,
            133700000100000000,
            1200,
            133700000000000000,
            "test",
            "default",
            "0123456789abcdef0123456789abcdef",
            "LocalMediaTransferPipe.Test",
            key);
        const string clientNonce = "00112233445566778899aabbccddeeff";
        string credentialId = Convert.ToHexString(SHA256.HashData(key)).ToLowerInvariant();
        var unsigned = new ServerOwnershipProof(
            ServerOwnershipProtocol.ProtocolVersion,
            2200,
            133700000100000000,
            expectation.OwnerProcessId,
            expectation.OwnerProcessStartTimeUtcFileTime,
            expectation.Environment,
            expectation.RuntimeInstanceId,
            expectation.ControlInstanceId,
            expectation.PipeName,
            clientNonce,
            "ffeeddccbbaa99887766554433221100",
            credentialId,
            "");
        string payload = string.Join('\n',
            "lmt-pipe-session-proof-v1",
            unsigned.ClientNonce,
            unsigned.ServerNonce,
            unsigned.ServerProcessId.ToString(CultureInfo.InvariantCulture),
            unsigned.ServerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
            unsigned.OwnerProcessId.ToString(CultureInfo.InvariantCulture),
            unsigned.OwnerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
            unsigned.Environment,
            unsigned.RuntimeInstanceId,
            unsigned.ControlInstanceId,
            unsigned.PipeName,
            unsigned.CredentialId);
        string proof = Convert.ToHexString(HMACSHA256.HashData(
            key,
            Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
        var signed = unsigned with { Proof = proof };

        Assert(ServerOwnershipProtocol.VerifySessionProof(
            signed,
            expectation,
            clientNonce), "Valid pipe session proof was rejected.");
        Assert(!ServerOwnershipProtocol.VerifySessionProof(
            signed with { ServerProcessId = signed.ServerProcessId + 1 },
            expectation,
            clientNonce), "Tampered pipe session identity was accepted.");
        return Task.CompletedTask;
    }

    private static async Task AcknowledgedPipeCommandsReportDelivery()
    {
        string pipeName = UniquePipeName();
        using var server = CreateServer(pipeName);
        using var client = new PipeClient(pipeName, 25);
        Task connection = server.WaitForConnectionAsync();
        client.Start();
        await connection.WaitAsync(TimeSpan.FromSeconds(5));
        await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));

        Task<PipeCommandAcknowledgement> command =
            client.SendAcknowledgedCommandAsync("revoke_device", "device-1");
        string requestJson = await ReadPipeMessage(server, CancellationToken.None);
        using JsonDocument request = JsonDocument.Parse(requestJson);
        string requestId = request.RootElement.GetProperty("requestId").GetString()!;
        await WritePipeMessage(server, JsonSerializer.Serialize(new
        {
            type = "command_result",
            data = new { requestId, success = true, error = "" }
        }));

        PipeCommandAcknowledgement result = await command;
        Assert(result.Success, "Acknowledged command did not report success.");
    }

    private static async Task DisconnectedSecurityCommandsFailClosed()
    {
        using var client = new PipeClient(UniquePipeName(), 25);
        PipeCommandAcknowledgement result =
            await client.RevokeDeviceAcknowledgedAsync("device-1");
        Assert(!result.Success, "Disconnected revocation reported success.");
    }

    private static async Task ReconnectReconciliationReappliesSecurityPolicy()
    {
        string pipeName = UniquePipeName();
        using var server = CreateServer(pipeName);
        using var client = new PipeClient(pipeName, 25);
        Task connection = server.WaitForConnectionAsync();
        client.Start();
        await connection.WaitAsync(TimeSpan.FromSeconds(5));
        await WaitUntil(() => client.IsConnected, TimeSpan.FromSeconds(5));

        Task<PipeCommandAcknowledgement> reconciliation =
            SecurityStateReconciler.ReconcileAsync(
                client,
                new string('a', 32),
                autoApproveKnownDevices: false,
                nearbyDiscovery: true);
        string[] expectedTypes =
            ["set_token", "set_auto_approve_known", "set_discovery_enabled"];
        string[] expectedData = [new string('a', 32), "false", "true"];
        for (int index = 0; index < expectedTypes.Length; index++)
        {
            string requestJson = await ReadPipeMessage(
                server,
                CancellationToken.None);
            using JsonDocument request = JsonDocument.Parse(requestJson);
            Assert(request.RootElement.GetProperty("type").GetString() == expectedTypes[index],
                "Reconnect reconciliation omitted or reordered security state.");
            Assert(request.RootElement.GetProperty("data").GetString() == expectedData[index],
                "Reconnect reconciliation sent the wrong security value.");
            string requestId = request.RootElement.GetProperty("requestId").GetString()!;
            await WritePipeMessage(server, JsonSerializer.Serialize(new
            {
                type = "command_result",
                data = new { requestId, success = true, error = "" }
            }));
        }

        PipeCommandAcknowledgement result = await reconciliation;
        Assert(result.Success, "Reconnect security reconciliation did not complete.");
    }

    private static Task PipeParserRejectsUnsafeTelemetry()
    {
        var negativeMetrics = PipeMessageParser.Parse(JsonSerializer.Serialize(new
        {
            type = "metrics",
            data = new
            {
                speedMBps = -1,
                speedAvailable = true,
                filesTransferred = 0,
                totalBytes = 0,
                durationSeconds = 0,
                isActive = true
            }
        }));
        Assert(!negativeMetrics.Success, "Negative metrics were accepted.");

        var pairing = PipeMessageParser.Parse(JsonSerializer.Serialize(new
        {
            type = "pairing_request",
            data = new
            {
                deviceId = "device-1",
                deviceName = "trusted\u202Eevil",
                ip = "192.0.2.1"
            }
        }));
        Assert(pairing.Success, "Neutralizable pairing text was rejected.");
        var request = (PairingRequestData)pairing.Message!.Payload!;
        Assert(!request.DeviceName.Contains('\u202E'),
            "Bidirectional control entered pairing UI text.");
        return Task.CompletedTask;
    }

    private static Task SecretRedactorCoversDiagnosticForms()
    {
        string redacted = SecretRedactor.Redact(
            "url=https://host/?token=abc123 credential: secret Authorization=BearerValue Bearer bearer-token");
        Assert(!redacted.Contains("abc123", StringComparison.Ordinal),
            "Query token was not redacted.");
        Assert(!redacted.Contains("secret", StringComparison.Ordinal),
            "Assigned credential was not redacted.");
        Assert(!redacted.Contains("bearer-token", StringComparison.Ordinal),
            "Bearer credential was not redacted.");
        return Task.CompletedTask;
    }

    private static Task PipeParserBoundsNativeApprovals()
    {
        PipeParseResult pairing = PipeMessageParser.Parse(JsonSerializer.Serialize(new
        {
            type = "native_pairing_request",
            data = new
            {
                requestId = new string('a', 32),
                deviceId = "windows-device",
                deviceName = "Sender PC",
                ip = "192.168.1.20",
                securityCode = "1234 5678"
            }
        }));
        Assert(pairing.Success, "Bounded native pairing summary was rejected.");
        var pairingData = (NativePairingRequestData)pairing.Message!.Payload!;
        Assert(pairingData.SecurityCode == "1234 5678", "Native security code was not parsed.");

        PipeParseResult transfer = PipeMessageParser.Parse(JsonSerializer.Serialize(new
        {
            type = "native_transfer_request",
            data = new
            {
                requestId = new string('b', 32),
                deviceId = "windows-device",
                deviceName = "Sender PC",
                ip = "192.168.1.20",
                fileCount = 3,
                totalBytes = 1234,
                sampleNames = new[] { "one.jpg", "two.mp4", "three.zip" }
            }
        }));
        Assert(transfer.Success, "Bounded native transfer summary was rejected.");
        var transferData = (NativeTransferRequestData)transfer.Message!.Payload!;
        Assert(transferData.SampleNames.Count == 3 && transferData.FileCount == 3,
            "Native transfer summary was not parsed.");

        PipeParseResult oversized = PipeMessageParser.Parse(JsonSerializer.Serialize(new
        {
            type = "native_transfer_request",
            data = new
            {
                requestId = new string('c', 32),
                deviceId = "windows-device",
                deviceName = "Sender PC",
                ip = "192.168.1.20",
                fileCount = 6,
                totalBytes = 6,
                sampleNames = Enumerable.Repeat("file", 6).ToArray()
            }
        }));
        Assert(!oversized.Success, "Oversized native transfer summary entered the UI queue.");
        return Task.CompletedTask;
    }

    private static Task ShellLauncherRejectsUnsafeSchemes()
    {
        Assert(!ShellLauncherService.TryOpenConnectionUri(
            "file:///C:/Windows/System32/calc.exe",
            allowInsecureHttp: true), "File URI was accepted as a connection URL.");
        Assert(!ShellLauncherService.TryOpenConnectionUri(
            "custom-handler://192.0.2.1/value",
            allowInsecureHttp: true), "Custom URI scheme was accepted.");
        Assert(!ShellLauncherService.TryOpenConnectionUri(
            "http://192.0.2.1:8080/#bootstrap=value",
            allowInsecureHttp: false), "HTTP URI bypassed the compatibility setting.");
        return Task.CompletedTask;
    }

    private static Task ResponsiveLayoutPreservesDesktopDensity()
    {
        Assert(!ResponsiveLayoutDecisions.UseDesktopPage(859), "Narrow pages should use the stacked layout.");
        Assert(ResponsiveLayoutDecisions.UseDesktopPage(860), "Normal desktop pages should use the dense layout.");
        Assert(!ResponsiveLayoutDecisions.UseDesktopTransferTable(1039), "Narrow history should use compact rows.");
        Assert(ResponsiveLayoutDecisions.UseDesktopTransferTable(1040), "Wide history should use the desktop table.");
        Assert(!ResponsiveLayoutDecisions.UseDesktopPage(double.NaN), "Invalid widths must fail to the safe narrow layout.");
        return Task.CompletedTask;
    }

    private static Task SettingsToggleDecisionsRequireConfirmation()
    {
        var enableHttp = SettingsToggleDecisions.ForHttpFallback(true);
        var disableHttp = SettingsToggleDecisions.ForHttpFallback(false);
        var enableDiscovery = SettingsToggleDecisions.ForNearbyDiscovery(true);
        var disableDiscovery = SettingsToggleDecisions.ForNearbyDiscovery(false);

        Assert(enableHttp.RequiresConfirmation, "Enabling HTTP fallback should require confirmation.");
        Assert(!disableHttp.RequiresConfirmation, "Disabling HTTP fallback should not require confirmation.");
        Assert(enableDiscovery.RequiresConfirmation, "Enabling nearby discovery should require confirmation.");
        Assert(!disableDiscovery.RequiresConfirmation, "Disabling nearby discovery should not require confirmation.");
        Assert(enableHttp.LogMessage(true).Contains("HTTP enabled", StringComparison.Ordinal), "HTTP enabled log is unclear.");
        Assert(disableDiscovery.LogMessage(false).Contains("disabled", StringComparison.OrdinalIgnoreCase), "Discovery disabled log is unclear.");
        return Task.CompletedTask;
    }

    private static Task SendStateMachineGatesActions()
    {
        Assert(!SendStateMachine.CanSelectFiles(SendState.Searching),
            "File picker was enabled during discovery.");
        Assert(SendStateMachine.CanSelectFiles(SendState.Connected),
            "File picker was disabled after connection.");
        Assert(!SendStateMachine.CanSend(SendState.FileSelection, 0),
            "Empty selection was sendable.");
        Assert(SendStateMachine.CanSend(SendState.FileSelection, 2),
            "Valid file selection was not sendable.");
        Assert(!SendStateMachine.CanSend(SendState.Uploading, 2),
            "A second send started while uploading.");
        return Task.CompletedTask;
    }

    private static Task BrowserTransferTimerUsesFiveMinutes()
    {
        DateTimeOffset created = new(2026, 8, 13, 12, 0, 0, TimeSpan.Zero);
        DateTimeOffset expires = created.AddSeconds(
            BrowserTransferSession.LifetimeSeconds);
        Assert(BrowserTransferSession.LifetimeSeconds == 300,
            "Browser transfer lifetime must be five minutes.");
        Assert(BrowserTransferSession.RemainingSeconds(expires, created) == 300,
            "Fresh browser link did not start at five minutes.");
        Assert(BrowserTransferSession.RemainingSeconds(
            expires, created.AddSeconds(241)) == 59,
            "Browser link countdown was not monotonic.");
        Assert(BrowserTransferSession.RemainingSeconds(expires, expires) == 0,
            "Expired browser link retained time.");
        Assert(BrowserTransferSession.FormatRemaining(300) == "5:00" &&
            BrowserTransferSession.FormatRemaining(59) == "0:59",
            "Browser link countdown formatting is unclear.");
        return Task.CompletedTask;
    }

    private static ServerManager CreateManager(
        FakeFactory factory,
        ApplicationEnvironmentProfile? environmentProfile = null,
        IServerOwnershipClient? ownershipClient = null)
    {
        return new ServerManager(
            factory,
            () => "fake-server.exe",
            monitorIntervalMs: 15,
            environmentProfile,
            ServerOwnershipContext.CreateEphemeral(),
            ownershipClient)
        {
            UploadDir = Path.GetTempPath(),
            Port = environmentProfile?.HttpsPort ?? 8080
        };
    }

    private static NamedPipeServerStream CreateServer(string pipeName)
    {
        return new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Message,
            PipeOptions.Asynchronous);
    }

    private static async Task WritePipeMessage(NamedPipeServerStream server, string message)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(message);
        await server.WriteAsync(bytes);
        await server.FlushAsync();
    }

    private static async Task<string> ReadPipeMessage(
        NamedPipeServerStream server,
        CancellationToken cancellationToken)
    {
        byte[] buffer = new byte[1024];
        using var output = new MemoryStream();
        do
        {
            int read = await server.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            output.Write(buffer, 0, read);
        } while (!server.IsMessageComplete);
        return Encoding.UTF8.GetString(output.ToArray());
    }

    private static async Task WaitForState(ServerManager manager, ServerManagerState state)
    {
        await WaitUntil(() => manager.State == state, TimeSpan.FromSeconds(3));
    }

    private static async Task WaitUntil(Func<bool> condition, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        while (!condition())
        {
            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException("Condition was not reached before timeout.");
            }
            await Task.Delay(10);
        }
    }

    private static string UniquePipeName() => $"LocalMediaTransfer.Tests.{Guid.NewGuid():N}";

    private static ServerOwnershipProof CreateTestProof(
        byte[]? key = null,
        string clientNonce = "00112233445566778899aabbccddeeff")
    {
        key ??= new byte[32];
        string credentialId = Convert.ToHexString(SHA256.HashData(key)).ToLowerInvariant();
        var unsigned = new ServerOwnershipProof(
            ServerOwnershipProtocol.ProtocolVersion,
            4200,
            133700000000000000,
            4100,
            133699999000000000,
            "test",
            "default",
            "0123456789abcdef0123456789abcdef",
            "LocalMediaTransferPipe.Test",
            clientNonce,
            "ffeeddccbbaa99887766554433221100",
            credentialId,
            "");
        string payload = string.Join('\n',
            "lmt-ownership-proof-v1",
            unsigned.ClientNonce,
            unsigned.ServerNonce,
            unsigned.ServerProcessId.ToString(CultureInfo.InvariantCulture),
            unsigned.ServerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
            unsigned.OwnerProcessId.ToString(CultureInfo.InvariantCulture),
            unsigned.OwnerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
            unsigned.Environment,
            unsigned.RuntimeInstanceId,
            unsigned.ControlInstanceId,
            unsigned.PipeName,
            unsigned.CredentialId);
        string signature = Convert.ToHexString(HMACSHA256.HashData(
            key,
            Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
        return unsigned with { Proof = signature };
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void AssertThrows<TException>(Action action, string message)
        where TException : Exception
    {
        try
        {
            action();
        }
        catch (TException)
        {
            return;
        }

        throw new InvalidOperationException(message);
    }
}

internal sealed class FakeFactory(params FakeServerProcess[] processes) : IServerProcessFactory
{
    private readonly Queue<FakeServerProcess> _processes = new(processes);
    public ServerLaunchOptions? LastOptions { get; private set; }

    public IServerProcess Create(ServerLaunchOptions options)
    {
        LastOptions = options;
        if (_processes.Count == 0)
        {
            throw new InvalidOperationException("No fake process remains.");
        }
        return _processes.Dequeue();
    }
}

internal sealed class FakeOwnershipClient(
    ServerOwnershipInspection inspection,
    bool shutdownResult = false) : IServerOwnershipClient
{
    public int InspectCalls { get; private set; }
    public int ShutdownCalls { get; private set; }

    public Task<ServerOwnershipInspection> InspectAsync(
        ServerOwnershipExpectation expectation,
        CancellationToken cancellationToken = default)
    {
        InspectCalls++;
        return Task.FromResult(inspection);
    }

    public Task<bool> RequestShutdownAsync(
        ServerOwnershipExpectation expectation,
        ServerOwnershipInspection previousInspection,
        CancellationToken cancellationToken = default)
    {
        ShutdownCalls++;
        return Task.FromResult(shutdownResult);
    }
}

internal sealed class FakeServerProcess : IServerProcess
{
    private static int _nextId = 100;

    public FakeServerProcess(bool hasExited = false, int exitCode = 0, int? id = null)
    {
        HasExited = hasExited;
        ExitCode = exitCode;
        Id = id ?? Interlocked.Increment(ref _nextId);
    }

    public event Action<string>? OutputReceived;

    public event Action<string>? ErrorReceived
    {
        add { }
        remove { }
    }

    public int Id { get; }
    public long StartTimeUtcFileTime { get; } =
        DateTime.UtcNow.ToFileTimeUtc();
    public bool HasExited { get; private set; }
    public int ExitCode { get; private set; }
    public bool Started { get; private set; }
    public bool Killed { get; private set; }

    public void Start() => Started = true;

    public void EmitOutput(string message) => OutputReceived?.Invoke(message);

    public void Kill()
    {
        Killed = true;
        HasExited = true;
        ExitCode = 0;
    }

    public Task<bool> WaitForExitAsync(
        TimeSpan timeout,
        CancellationToken cancellationToken = default) => Task.FromResult(HasExited);
    public void Dispose() { }
}
