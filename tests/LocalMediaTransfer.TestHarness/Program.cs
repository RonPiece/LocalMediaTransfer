using System.Diagnostics;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.IO.Pipes;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Runtime.InteropServices;

return await TestHarness.RunAsync(args);

internal static class TestHarness
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<int> RunAsync(string[] args)
    {
        HarnessOptions options;
        try
        {
            options = HarnessOptions.Parse(args);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            HarnessOptions.PrintHelp();
            return 2;
        }

        if (options.ShowHelp)
        {
            HarnessOptions.PrintHelp();
            return 0;
        }

        string repoRoot = FindRepoRoot();
        string serverDirectory = Path.Combine(repoRoot, "src", "Server");
        string serverExecutable = ResolveServerExecutable(options.ServerExecutable, serverDirectory);
        string testRoot = Path.Combine(Path.GetTempPath(), "LocalMediaTransfer.Tests");
        string runId = Guid.NewGuid().ToString("N");
        string runDirectory = Path.Combine(testRoot, runId);
        string uploadDirectory = Path.Combine(runDirectory, "uploads");
        string runtimeDataDirectory = Path.Combine(runDirectory, "runtime");
        string benchmarkDatabase = Path.Combine(runDirectory, "benchmark-results.db");
        string historyDatabase = Path.Combine(runDirectory, "transfer-history.db");
        int port = GetEphemeralPort();
        int httpsPort;
        do { httpsPort = GetEphemeralPort(); } while (httpsPort == port);
        string token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        var context = new HarnessContext(
            repoRoot,
            serverDirectory,
            serverExecutable,
            testRoot,
            runId,
            runDirectory,
            uploadDirectory,
            runtimeDataDirectory,
            benchmarkDatabase,
            historyDatabase,
            port,
            httpsPort,
            Path.Combine(runDirectory, "tls"),
            token);

        OwnedProcess? server = null;
        PipeConnection? pipe = null;
        int exitCode = 1;

        Directory.CreateDirectory(uploadDirectory);
        AssertSafeTestDirectory(testRoot, runDirectory);

        try
        {
            Console.WriteLine($"Test upload directory: {uploadDirectory}");
            Console.WriteLine($"Ephemeral port: {port}");
            Console.WriteLine($"Server executable: {serverExecutable}");

            if (options.OwnershipOnly)
            {
                await VerifyAuthenticatedOwnershipControlAsync(context);
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("Authenticated ownership control check passed.");
                Console.ResetColor();
                exitCode = 0;
                return exitCode;
            }

            if (!string.IsNullOrEmpty(options.BenchmarkProfile))
            {
                Console.WriteLine("Starting isolated benchmark server...");
                server = await StartServerAsync(context, benchmarkMode: true);
                pipe = await ConnectPipeAsync(context.BenchmarkPipeName, token);
                await RunBenchmarkRunnerAsync(context, options.BenchmarkProfile);

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine(
                    $"Benchmark runner '{options.BenchmarkProfile}' check passed.");
                Console.ResetColor();
                exitCode = 0;
                return exitCode;
            }

            Console.WriteLine("Starting isolated server...");
            await VerifyRuntimeConfigContractAsync(context);
            await VerifyEnvironmentArgumentValidationAsync(context);
            await VerifyAuthenticatedOwnershipControlAsync(context);

            string managedOrphan = Path.Combine(
                uploadDirectory,
                ".ios-1785139292612-159.tmp");
            string unrelatedTemporaryFile = Path.Combine(
                uploadDirectory,
                ".user-notes.tmp");
            await File.WriteAllBytesAsync(managedOrphan, [1, 2, 3, 4]);
            await File.WriteAllBytesAsync(unrelatedTemporaryFile, [5, 6, 7, 8]);

            server = await StartServerAsync(context, benchmarkMode: false, allowInsecureHttp: false);
            if (File.Exists(managedOrphan))
            {
                throw new InvalidOperationException(
                    "Server startup did not remove a managed orphaned iOS upload file.");
            }
            if (!File.Exists(unrelatedTemporaryFile))
            {
                throw new InvalidOperationException(
                    "Server startup removed an unrelated user temporary file.");
            }
            File.Delete(unrelatedTemporaryFile);
            await VerifyHttpsAsync(context);
            await VerifyChangedFingerprintRejectedAsync(context);
            await AssertHttpFallbackClosedAsync(context);
            await StopServerAsync(server);
            server = null;

            server = await StartServerAsync(context, benchmarkMode: false);
            pipe = await ConnectPipeAsync(context.TestPipeName, token);
            string initialTlsFingerprint = await VerifyHttpsAsync(context);
            await VerifyTlsPolicyAsync(context);
            await AssertBenchmarkRoutesDisabledAsync(context);
            await VerifySecondInstanceAsync(context, server);
            await VerifyDistinctTestInstanceAsync(context, server);
            await VerifyDiscoveryAndPairingAsync(context, pipe);
            await VerifyNativeWindowsTransferAsync(context, pipe);
            await VerifyOneTimeBrowserBootstrapAsync(context, pipe);

            Console.WriteLine("Running isolated HTTP integration suite...");
            await RunPowerShellServerSuiteAsync(context, options.SkipLargeBoundaryTests);
            await VerifyPreflightAndHistoryAsync(context);

            Console.WriteLine("Verifying SQLite persistence across restart...");
            string persistenceHash = await SeedPersistenceAsync(context);
            await pipe.DisposeAsync();
            pipe = null;
            await StopServerAsync(server);
            server = null;
            VerifyClientLogPrivacy(context);

            server = await StartServerAsync(context, benchmarkMode: false);
            pipe = await ConnectPipeAsync(context.TestPipeName, token);
            string restartedTlsFingerprint = await VerifyHttpsAsync(context);
            if (!string.Equals(initialTlsFingerprint, restartedTlsFingerprint, StringComparison.Ordinal))
                throw new InvalidOperationException("TLS fingerprint changed across server restart.");
            await VerifyPersistenceAsync(context, persistenceHash);
            await VerifyHistoryPersistenceAsync(context);
            await VerifyHistoryDeletionAsync(context, pipe);

            Console.WriteLine("Verifying strict filename-conflict mode...");
            await pipe.DisposeAsync();
            pipe = null;
            await StopServerAsync(server);
            server = null;

            server = await StartServerAsync(
                context,
                benchmarkMode: false,
                filenameConflictPolicy: "reject");
            pipe = await ConnectPipeAsync(context.TestPipeName, token);
            await VerifyRejectFilenameConflictAsync(context);

            Console.WriteLine("Verifying opt-in benchmark mode and persistence...");
            await pipe.DisposeAsync();
            pipe = null;
            await StopServerAsync(server);
            server = null;

            server = await StartServerAsync(context, benchmarkMode: true);
            pipe = await ConnectPipeAsync(context.BenchmarkPipeName, token);
            string benchmarkRunId = await VerifyBenchmarkModeAsync(context);

            await pipe.DisposeAsync();
            pipe = null;
            await StopServerAsync(server);
            server = null;

            server = await StartServerAsync(context, benchmarkMode: true);
            pipe = await ConnectPipeAsync(context.BenchmarkPipeName, token);
            await VerifyBenchmarkPersistenceAsync(context, benchmarkRunId);

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("All isolated server checks passed.");
            Console.ResetColor();
            exitCode = 0;
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.Error.WriteLine($"Server test harness failed: {ex}");
            if (server?.HasExited == true)
            {
                Console.Error.WriteLine(
                    $"Server exited with code {server.ExitCode}.{server.FormatCapturedOutput()}");
            }
            Console.ResetColor();
        }
        finally
        {
            if (pipe is not null)
            {
                await pipe.DisposeAsync();
            }
            if (server is not null)
            {
                await StopServerAsync(server);
            }

            if (options.KeepArtifacts)
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine($"Keeping test artifacts at: {runDirectory}");
                Console.ResetColor();
            }
            else if (Directory.Exists(runDirectory))
            {
                try
                {
                    await DeleteDirectoryWithRetryAsync(testRoot, runDirectory);
                    if (Directory.Exists(testRoot) &&
                        !Directory.EnumerateFileSystemEntries(testRoot).Any())
                    {
                        Directory.Delete(testRoot);
                    }
                }
                catch (Exception ex)
                {
                    Console.ForegroundColor = ConsoleColor.Yellow;
                    Console.Error.WriteLine($"Cleanup warning: {ex.Message}");
                    Console.ResetColor();
                    exitCode = 1;
                }
            }
        }

        return exitCode;
    }

    private static async Task<OwnedProcess> StartServerAsync(
        HarnessContext context,
        bool benchmarkMode,
        string filenameConflictPolicy = "keep-both",
        bool allowInsecureHttp = true,
        string? controlToken = null,
        int ownerProcessId = 0,
        long ownerProcessStartTimeUtcFileTime = 0,
        string? controlInstanceId = null,
        bool verifyHttps = true)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = context.ServerExecutable,
            WorkingDirectory = context.ServerDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = controlToken != null
        };
        startInfo.ArgumentList.Add("--environment");
        startInfo.ArgumentList.Add(benchmarkMode ? "benchmark" : "test");
        startInfo.ArgumentList.Add("--instance-id");
        startInfo.ArgumentList.Add(context.RunId);
        startInfo.ArgumentList.Add("--data-root");
        startInfo.ArgumentList.Add(context.RuntimeDataDirectory);
        startInfo.ArgumentList.Add("--https-port");
        startInfo.ArgumentList.Add(context.HttpsPort.ToString());
        startInfo.ArgumentList.Add("--http-port");
        startInfo.ArgumentList.Add(context.Port.ToString());
        if (allowInsecureHttp) startInfo.ArgumentList.Add("--allow-insecure-http");
        startInfo.ArgumentList.Add("--tls-storage-dir");
        startInfo.ArgumentList.Add(context.TlsDirectory);
        startInfo.ArgumentList.Add("--upload-dir");
        startInfo.ArgumentList.Add(context.UploadDirectory);
        startInfo.ArgumentList.Add("--history-db");
        startInfo.ArgumentList.Add(context.HistoryDatabase);
        startInfo.ArgumentList.Add("--filename-conflict");
        startInfo.ArgumentList.Add(filenameConflictPolicy);
        if (controlToken != null)
        {
            startInfo.ArgumentList.Add("--control-token-stdin");
            startInfo.ArgumentList.Add("--owner-process-id");
            startInfo.ArgumentList.Add(ownerProcessId.ToString());
            startInfo.ArgumentList.Add("--owner-process-start-time");
            startInfo.ArgumentList.Add(ownerProcessStartTimeUtcFileTime.ToString());
            startInfo.ArgumentList.Add("--control-instance-id");
            startInfo.ArgumentList.Add(controlInstanceId ?? "");
        }
        if (benchmarkMode)
        {
            startInfo.ArgumentList.Add("--benchmark-mode");
            startInfo.ArgumentList.Add("--benchmark-db");
            startInfo.ArgumentList.Add(context.BenchmarkDatabase);
        }

        var owned = OwnedProcess.Start(startInfo, "server", standardInputLine: controlToken);
        string expectedEnvironment = benchmarkMode ? "benchmark" : "test";
        try
        {
            if (allowInsecureHttp)
                await WaitForHealthAsync(owned, context.Port, expectedEnvironment);

            if (verifyHttps)
            {
                Exception? lastError = null;
                for (int attempt = 0; attempt < 50; attempt++)
                {
                    try
                    {
                        await VerifyHttpsAsync(context, expectedEnvironment);
                        lastError = null;
                        break;
                    }
                    catch (Exception error) { lastError = error; await Task.Delay(100); }
                }
                if (lastError != null) throw lastError;
            }

            return owned;
        }
        catch
        {
            await owned.StopAsync();
            throw;
        }
    }

    private static async Task VerifyAuthenticatedOwnershipControlAsync(
        HarnessContext context)
    {
        Console.WriteLine("Verifying authenticated exact-process ownership control...");
        string instanceId = "ownership-" + Guid.NewGuid().ToString("N");
        int httpPort = GetEphemeralPort();
        int httpsPort;
        do { httpsPort = GetEphemeralPort(); } while (httpsPort == httpPort);
        string runtimeRoot = Path.Combine(context.RunDirectory, instanceId);
        var ownershipContext = context with
        {
            RunId = instanceId,
            UploadDirectory = Path.Combine(runtimeRoot, "uploads"),
            RuntimeDataDirectory = Path.Combine(runtimeRoot, "runtime"),
            HistoryDatabase = Path.Combine(runtimeRoot, "transfer-history.db"),
            Port = httpPort,
            HttpsPort = httpsPort,
            TlsDirectory = Path.Combine(runtimeRoot, "tls")
        };
        Directory.CreateDirectory(ownershipContext.UploadDirectory);

        byte[] controlKey = RandomNumberGenerator.GetBytes(32);
        string controlToken = Convert.ToHexString(controlKey).ToLowerInvariant();
        const int staleOwnerProcessId = int.MaxValue - 100;
        const long staleOwnerStartTime = 1;
        string controlInstanceId = Guid.NewGuid().ToString("N");

        await using OwnedProcess server = await StartServerAsync(
            ownershipContext,
            benchmarkMode: false,
            controlToken: controlToken,
            ownerProcessId: staleOwnerProcessId,
            ownerProcessStartTimeUtcFileTime: staleOwnerStartTime,
            controlInstanceId: controlInstanceId,
            verifyHttps: false);
        try
        {
            using var pipe = new NamedPipeClientStream(
                ".",
                ownershipContext.TestPipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);
            await pipe.ConnectAsync(3000);
            pipe.ReadMode = PipeTransmissionMode.Message;

            string clientNonce = Convert.ToHexString(
                RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            await SendRawPipeCommandAsync(
                pipe,
                "ownership_probe",
                JsonSerializer.Serialize(new
                {
                    protocolVersion = 1,
                    clientNonce
                }));
            JsonElement proof = await ReadPipeDataAsync(
                pipe,
                "ownership_proof",
                TimeSpan.FromSeconds(3));

            int provedPid = proof.GetProperty("serverProcessId").GetInt32();
            long provedStartTime = long.Parse(
                proof.GetProperty("serverProcessStartTimeUtcFileTime").GetString()!);
            AssertEqual(server.Id, provedPid, "Ownership proof returned another server PID.");
            AssertEqual(server.StartTimeUtcFileTime, provedStartTime,
                "Ownership proof returned another server creation time.");
            AssertEqual(staleOwnerProcessId,
                proof.GetProperty("ownerProcessId").GetInt32(),
                "Ownership proof returned another GUI owner PID.");
            AssertEqual(staleOwnerStartTime,
                long.Parse(proof.GetProperty("ownerProcessStartTimeUtcFileTime").GetString()!),
                "Ownership proof returned another GUI owner creation time.");
            AssertEqual("test", proof.GetProperty("environment").GetString(),
                "Ownership proof crossed environments.");
            AssertEqual(instanceId, proof.GetProperty("runtimeInstanceId").GetString(),
                "Ownership proof crossed runtime instances.");
            AssertEqual(controlInstanceId, proof.GetProperty("controlInstanceId").GetString(),
                "Ownership proof returned another GUI instance.");
            AssertEqual(ownershipContext.TestPipeName, proof.GetProperty("pipeName").GetString(),
                "Ownership proof returned another control endpoint.");

            string credentialId = Convert.ToHexString(
                SHA256.HashData(controlKey)).ToLowerInvariant();
            AssertEqual(credentialId, proof.GetProperty("credentialId").GetString(),
                "Ownership proof returned another credential identity.");
            string proofPayload = BuildOwnershipProofPayload(proof);
            string expectedProof = Convert.ToHexString(HMACSHA256.HashData(
                controlKey,
                Encoding.UTF8.GetBytes(proofPayload))).ToLowerInvariant();
            Assert(CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(expectedProof),
                    Encoding.ASCII.GetBytes(proof.GetProperty("proof").GetString()!)),
                "The real server ownership proof has an invalid HMAC.");

            string sessionNonce = Convert.ToHexString(
                RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            string sessionRequestPayload = string.Join('\n',
                "lmt-pipe-session-request-v1",
                sessionNonce,
                staleOwnerProcessId,
                staleOwnerStartTime,
                "test",
                instanceId,
                controlInstanceId,
                ownershipContext.TestPipeName);
            string sessionAuthorization = Convert.ToHexString(
                HMACSHA256.HashData(
                    controlKey,
                    Encoding.UTF8.GetBytes(sessionRequestPayload)))
                .ToLowerInvariant();
            await SendRawPipeCommandAsync(
                pipe,
                "session_auth",
                JsonSerializer.Serialize(new
                {
                    protocolVersion = 1,
                    clientNonce = sessionNonce,
                    ownerProcessId = staleOwnerProcessId,
                    ownerProcessStartTimeUtcFileTime = staleOwnerStartTime.ToString(),
                    environment = "test",
                    runtimeInstanceId = instanceId,
                    controlInstanceId,
                    pipeName = ownershipContext.TestPipeName,
                    authorization = sessionAuthorization
                }));
            JsonElement sessionProof = await ReadPipeDataAsync(
                pipe,
                "session_ready",
                TimeSpan.FromSeconds(3));
            string sessionProofPayload = string.Join('\n',
                "lmt-pipe-session-proof-v1",
                sessionProof.GetProperty("clientNonce").GetString(),
                sessionProof.GetProperty("serverNonce").GetString(),
                sessionProof.GetProperty("serverProcessId").GetInt32(),
                sessionProof.GetProperty("serverProcessStartTimeUtcFileTime").GetString(),
                sessionProof.GetProperty("ownerProcessId").GetInt32(),
                sessionProof.GetProperty("ownerProcessStartTimeUtcFileTime").GetString(),
                sessionProof.GetProperty("environment").GetString(),
                sessionProof.GetProperty("runtimeInstanceId").GetString(),
                sessionProof.GetProperty("controlInstanceId").GetString(),
                sessionProof.GetProperty("pipeName").GetString(),
                sessionProof.GetProperty("credentialId").GetString());
            string expectedSessionProof = Convert.ToHexString(
                HMACSHA256.HashData(
                    controlKey,
                    Encoding.UTF8.GetBytes(sessionProofPayload)))
                .ToLowerInvariant();
            Assert(CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(expectedSessionProof),
                    Encoding.ASCII.GetBytes(
                        sessionProof.GetProperty("proof").GetString()!)),
                "The live pipe session proof has an invalid HMAC.");

            string requestId = Guid.NewGuid().ToString("N");
            await SendRawPipeCommandAsync(
                pipe,
                "set_auto_approve_known",
                "false",
                requestId);
            JsonElement commandResult = await ReadPipeDataAsync(
                pipe,
                "command_result",
                TimeSpan.FromSeconds(3));
            AssertEqual(requestId, commandResult.GetProperty("requestId").GetString(),
                "Acknowledgement did not match the live pipe command.");
            Assert(commandResult.GetProperty("success").GetBoolean(),
                "Authenticated live pipe command was not acknowledged.");

            await SendRawPipeCommandAsync(
                pipe,
                "ownership_shutdown",
                JsonSerializer.Serialize(new
                {
                    protocolVersion = 1,
                    clientNonce,
                    serverNonce = proof.GetProperty("serverNonce").GetString(),
                    authorization = new string('0', 64)
                }));
            await Task.Delay(200);
            Assert(!server.HasExited,
                "The real server accepted an unauthenticated shutdown request.");

            string shutdownPayload = BuildOwnershipShutdownPayload(proof);
            string authorization = Convert.ToHexString(HMACSHA256.HashData(
                controlKey,
                Encoding.UTF8.GetBytes(shutdownPayload))).ToLowerInvariant();
            await SendRawPipeCommandAsync(
                pipe,
                "ownership_shutdown",
                JsonSerializer.Serialize(new
                {
                    protocolVersion = 1,
                    clientNonce,
                    serverNonce = proof.GetProperty("serverNonce").GetString(),
                    authorization
                }));
            Assert(await server.WaitForExitAsync(TimeSpan.FromSeconds(5)),
                "The real server did not honor its authenticated graceful shutdown.");
            AssertEqual(0, server.ExitCode,
                "Authenticated graceful shutdown returned a failure exit code.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(controlKey);
        }
    }

    private static string BuildOwnershipProofPayload(JsonElement proof) =>
        string.Join('\n',
            "lmt-ownership-proof-v1",
            proof.GetProperty("clientNonce").GetString(),
            proof.GetProperty("serverNonce").GetString(),
            proof.GetProperty("serverProcessId").GetInt32(),
            proof.GetProperty("serverProcessStartTimeUtcFileTime").GetString(),
            proof.GetProperty("ownerProcessId").GetInt32(),
            proof.GetProperty("ownerProcessStartTimeUtcFileTime").GetString(),
            proof.GetProperty("environment").GetString(),
            proof.GetProperty("runtimeInstanceId").GetString(),
            proof.GetProperty("controlInstanceId").GetString(),
            proof.GetProperty("pipeName").GetString(),
            proof.GetProperty("credentialId").GetString());

    private static string BuildOwnershipShutdownPayload(JsonElement proof) =>
        string.Join('\n',
            "lmt-shutdown-v1",
            proof.GetProperty("clientNonce").GetString(),
            proof.GetProperty("serverNonce").GetString(),
            proof.GetProperty("serverProcessId").GetInt32(),
            proof.GetProperty("serverProcessStartTimeUtcFileTime").GetString(),
            proof.GetProperty("environment").GetString(),
            proof.GetProperty("runtimeInstanceId").GetString(),
            proof.GetProperty("controlInstanceId").GetString(),
            proof.GetProperty("pipeName").GetString());

    private static async Task SendRawPipeCommandAsync(
        NamedPipeClientStream pipe,
        string type,
        string data,
        string? requestId = null)
    {
        byte[] command = requestId == null
            ? JsonSerializer.SerializeToUtf8Bytes(new { type, data })
            : JsonSerializer.SerializeToUtf8Bytes(new { type, data, requestId });
        await pipe.WriteAsync(command);
        await pipe.FlushAsync();
    }

    private static async Task VerifyOneTimeBrowserBootstrapAsync(
        HarnessContext context,
        PipeConnection pipe)
    {
        string replacedBootstrap = Convert.ToHexString(
            RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        string bootstrap = Convert.ToHexString(
            RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        await pipe.SendAcknowledgedCommandAsync("set_browser_bootstrap", replacedBootstrap);
        await pipe.SendAcknowledgedCommandAsync("set_browser_bootstrap", bootstrap);

        using var http = new HttpClient
        {
            BaseAddress = new Uri($"http://127.0.0.1:{context.Port}"),
            Timeout = TimeSpan.FromSeconds(5)
        };
        using HttpResponseMessage configResponse = await http.GetAsync("/config");
        configResponse.EnsureSuccessStatusCode();
        using JsonDocument configBody = JsonDocument.Parse(
            await configResponse.Content.ReadAsStringAsync());
        AssertEqual(300,
            configBody.RootElement.GetProperty(
                "browserBootstrapLifetimeSeconds").GetInt32(),
            "Browser bootstrap lifetime contract changed.");

        using HttpResponseMessage replaced = await http.PostAsJsonAsync(
            "/exchange_bootstrap",
            new { bootstrap = replacedBootstrap });
        AssertEqual(HttpStatusCode.Forbidden, replaced.StatusCode,
            "Replacing a browser bootstrap left the previous link usable.");

        using HttpResponseMessage first = await http.PostAsJsonAsync(
            "/exchange_bootstrap",
            new { bootstrap });
        first.EnsureSuccessStatusCode();
        using JsonDocument firstBody = JsonDocument.Parse(
            await first.Content.ReadAsStringAsync());
        AssertEqual(context.Token, firstBody.RootElement.GetProperty("token").GetString(),
            "Bootstrap exchange returned another session token.");

        using HttpResponseMessage replay = await http.PostAsJsonAsync(
            "/exchange_bootstrap",
            new { bootstrap });
        AssertEqual(HttpStatusCode.Forbidden, replay.StatusCode,
            "One-time browser bootstrap was accepted twice.");

    }

    private static async Task<JsonElement> ReadPipeDataAsync(
        NamedPipeClientStream pipe,
        string expectedType,
        TimeSpan timeout)
    {
        using var cancellation = new CancellationTokenSource(timeout);
        byte[] buffer = new byte[4096];
        while (true)
        {
            using var output = new MemoryStream();
            do
            {
                int read = await pipe.ReadAsync(buffer, cancellation.Token);
                if (read == 0) throw new IOException("Ownership pipe disconnected.");
                output.Write(buffer, 0, read);
            } while (!pipe.IsMessageComplete);

            using JsonDocument message = JsonDocument.Parse(output.ToArray());
            if (message.RootElement.GetProperty("type").GetString() == expectedType)
                return message.RootElement.GetProperty("data").Clone();
        }
    }

    private static async Task VerifyEnvironmentArgumentValidationAsync(
        HarnessContext context)
    {
        Console.WriteLine("Verifying fail-closed environment arguments...");

        async Task ExpectFailureAsync(string expectedMessage, params string[] arguments)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = context.ServerExecutable,
                WorkingDirectory = context.ServerDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            foreach (string argument in arguments) startInfo.ArgumentList.Add(argument);

            await using OwnedProcess process = OwnedProcess.Start(startInfo, "invalid server");
            if (!await process.WaitForExitAsync(TimeSpan.FromSeconds(10)))
            {
                await process.StopAsync();
                throw new TimeoutException("Invalid server configuration did not exit.");
            }
            string output = process.FormatCapturedOutput();
            if (process.ExitCode != 1 ||
                !output.Contains(expectedMessage, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"Expected startup failure containing '{expectedMessage}', got exit " +
                    $"code {process.ExitCode}.{output}");
            }
        }

        await ExpectFailureAsync(
            "--environment must be",
            "--environment", "staging");
        await ExpectFailureAsync(
            "must be enabled together",
            "--environment", "test", "--benchmark-mode");
        await ExpectFailureAsync(
            "available only in test and benchmark",
            "--environment", "production", "--data-root", context.RuntimeDataDirectory);
        await ExpectFailureAsync(
            "requires --instance-id",
            "--environment", "benchmark", "--benchmark-mode");
    }

    private static async Task VerifyRuntimeConfigContractAsync(HarnessContext context)
    {
        Console.WriteLine("Verifying stable runtime-environment defaults...");
        string localAppData = Path.Combine(context.RunDirectory, "config-contract-localappdata");

        async Task<JsonElement> ReadConfigAsync(string environment, string? instanceId = null)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = context.ServerExecutable,
                WorkingDirectory = context.ServerDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            startInfo.Environment["LOCALAPPDATA"] = localAppData;
            startInfo.ArgumentList.Add("--environment");
            startInfo.ArgumentList.Add(environment);
            if (!string.IsNullOrWhiteSpace(instanceId))
            {
                startInfo.ArgumentList.Add("--instance-id");
                startInfo.ArgumentList.Add(instanceId);
            }
            startInfo.ArgumentList.Add("--print-runtime-config");

            await using OwnedProcess process = OwnedProcess.Start(startInfo, "runtime config probe");
            if (!await process.WaitForExitAsync(TimeSpan.FromSeconds(10)) || process.ExitCode != 0)
            {
                throw new InvalidOperationException(
                    $"Runtime config probe failed.{process.FormatCapturedOutput()}");
            }
            return JsonDocument.Parse(process.CapturedStandardOutput).RootElement.Clone();
        }

        JsonElement production = await ReadConfigAsync("production");
        AssertRuntimeConfig(
            production,
            "production",
            "LocalMediaTransfer",
            "LocalMediaTransferPipe",
            "LocalMediaTransferServer.SingleInstance",
            8443,
            8080,
            45892,
            discoveryAllowed: true,
            dataRoot: Path.Combine(localAppData, "LocalMediaTransfer"));

        JsonElement test = await ReadConfigAsync("test");
        AssertRuntimeConfig(
            test,
            "test",
            "LocalMediaTransfer.Test",
            "LocalMediaTransferPipe.Test",
            "LocalMediaTransferServer.Test.SingleInstance",
            18443,
            18080,
            45893,
            discoveryAllowed: true,
            dataRoot: Path.Combine(localAppData, "LocalMediaTransfer.Test"));

        JsonElement benchmark = await ReadConfigAsync("benchmark", "contract-run");
        AssertRuntimeConfig(
            benchmark,
            "benchmark",
            "LocalMediaTransfer.Benchmark",
            "LocalMediaTransferPipe.Benchmark.contract-run",
            "LocalMediaTransferServer.Benchmark.SingleInstance.contract-run",
            28443,
            28080,
            0,
            discoveryAllowed: false,
            dataRoot: Path.Combine(localAppData, "LocalMediaTransfer.Benchmark", "instances", "contract-run"));
    }

    private static void AssertRuntimeConfig(
        JsonElement config,
        string environment,
        string dataNamespace,
        string pipeName,
        string mutexName,
        int httpsPort,
        int httpPort,
        int discoveryPort,
        bool discoveryAllowed,
        string dataRoot)
    {
        if (config.GetProperty("environment").GetString() != environment ||
            config.GetProperty("dataNamespace").GetString() != dataNamespace ||
            config.GetProperty("pipeName").GetString() != pipeName ||
            config.GetProperty("mutexName").GetString() != mutexName ||
            config.GetProperty("httpsPort").GetInt32() != httpsPort ||
            config.GetProperty("httpPort").GetInt32() != httpPort ||
            config.GetProperty("discoveryPort").GetInt32() != discoveryPort ||
            config.GetProperty("discoveryAllowed").GetBoolean() != discoveryAllowed ||
            !string.Equals(
                Path.GetFullPath(config.GetProperty("dataRoot").GetString()!),
                Path.GetFullPath(dataRoot),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Runtime config contract mismatch for {environment}: {config}");
        }
    }

    private static async Task VerifyRejectFilenameConflictAsync(HarnessContext context)
    {
        byte[] firstContent = Encoding.UTF8.GetBytes("strict original");
        byte[] secondContent = Encoding.UTF8.GetBytes("strict different");

        using var http = CreateHttpClient(context);
        using (var first = new MultipartFormDataContent())
        {
            first.Add(new ByteArrayContent(firstContent), "file", "strict-conflict.txt");
            using HttpResponseMessage firstResponse =
                await http.PostAsync("/upload_single", first);
            firstResponse.EnsureSuccessStatusCode();
        }

        using var second = new MultipartFormDataContent();
        second.Add(new ByteArrayContent(secondContent), "file", "strict-conflict.txt");
        using HttpResponseMessage secondResponse =
            await http.PostAsync("/upload_single", second);
        if (secondResponse.StatusCode != HttpStatusCode.Conflict)
        {
            string body = await secondResponse.Content.ReadAsStringAsync();
            throw new InvalidOperationException(
                $"Strict filename policy expected HTTP 409, got " +
                $"{(int)secondResponse.StatusCode}: {body}");
        }

        string savedPath = Path.Combine(
            context.UploadDirectory,
            "strict-conflict.txt");
        byte[] savedContent = await File.ReadAllBytesAsync(savedPath);
        if (!savedContent.SequenceEqual(firstContent))
        {
            throw new InvalidOperationException(
                "Strict filename policy modified the existing file.");
        }
    }

    private static async Task WaitForHealthAsync(
        OwnedProcess process,
        int port,
        string expectedEnvironment)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
        DateTime deadline = DateTime.UtcNow.AddSeconds(15);
        Exception? lastError = null;

        while (DateTime.UtcNow < deadline)
        {
            if (process.HasExited)
            {
                throw new InvalidOperationException(
                    $"Server exited during startup with code {process.ExitCode}.{process.FormatCapturedOutput()}");
            }

            try
            {
                using HttpResponseMessage response =
                    await http.GetAsync($"http://127.0.0.1:{port}/_health");
                if (response.IsSuccessStatusCode)
                {
                    using JsonDocument body =
                        JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                    if (body.RootElement.GetProperty("status").GetString() == "ok" &&
                        body.RootElement.GetProperty("environment").GetString() == expectedEnvironment)
                    {
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                lastError = ex;
            }

            await Task.Delay(150);
        }

        throw new TimeoutException(
            $"Server did not become healthy on port {port} within 15 seconds. " +
            lastError?.Message);
    }

    private static async Task<PipeConnection> ConnectPipeAsync(string pipeName, string token)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(15);
        Exception? lastError = null;

        while (DateTime.UtcNow < deadline)
        {
            var client = new NamedPipeClientStream(
                ".",
                pipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                await client.ConnectAsync(timeout.Token);
                client.ReadMode = PipeTransmissionMode.Message;
                byte[] command = JsonSerializer.SerializeToUtf8Bytes(new
                {
                    type = "set_token",
                    data = token
                });
                await client.WriteAsync(command);
                await client.FlushAsync();
                await Task.Delay(250);
                return new PipeConnection(client);
            }
            catch (Exception ex)
            {
                lastError = ex;
                client.Dispose();
                await Task.Delay(150);
            }
        }

        throw new TimeoutException(
            $"Named pipe did not become available within 15 seconds: {lastError?.Message}");
    }

    private static async Task VerifySecondInstanceAsync(
        HarnessContext context,
        OwnedProcess original)
    {
        Console.WriteLine("Verifying second-instance protection...");
        var startInfo = new ProcessStartInfo
        {
            FileName = context.ServerExecutable,
            WorkingDirectory = context.ServerDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.ArgumentList.Add("--environment");
        startInfo.ArgumentList.Add("test");
        startInfo.ArgumentList.Add("--instance-id");
        startInfo.ArgumentList.Add(context.RunId);
        startInfo.ArgumentList.Add("--data-root");
        startInfo.ArgumentList.Add(context.RuntimeDataDirectory);
        startInfo.ArgumentList.Add("--https-port");
        startInfo.ArgumentList.Add(context.HttpsPort.ToString());
        startInfo.ArgumentList.Add("--http-port");
        startInfo.ArgumentList.Add(context.Port.ToString());
        startInfo.ArgumentList.Add("--upload-dir");
        startInfo.ArgumentList.Add(context.UploadDirectory);
        startInfo.ArgumentList.Add("--history-db");
        startInfo.ArgumentList.Add(context.HistoryDatabase);

        await using OwnedProcess second = OwnedProcess.Start(startInfo, "second server");
        if (!await second.WaitForExitAsync(TimeSpan.FromSeconds(10)))
        {
            await second.StopAsync();
            throw new TimeoutException("Second server instance did not exit.");
        }
        if (second.ExitCode != 2)
        {
            throw new InvalidOperationException(
                $"Expected second server exit code 2, got {second.ExitCode}.{second.FormatCapturedOutput()}");
        }
        if (original.HasExited)
        {
            throw new InvalidOperationException(
                "The original server was terminated by the second-instance check.");
        }
    }

    private static async Task VerifyDistinctTestInstanceAsync(
        HarnessContext context,
        OwnedProcess original)
    {
        Console.WriteLine("Verifying isolated test instances can run side by side...");
        int httpPort = GetEphemeralPort();
        int httpsPort;
        do { httpsPort = GetEphemeralPort(); } while (httpsPort == httpPort);

        string instanceId = context.RunId + "-parallel";
        string instanceRoot = Path.Combine(context.RunDirectory, "parallel-instance");
        string uploadDirectory = Path.Combine(instanceRoot, "uploads");
        Directory.CreateDirectory(uploadDirectory);
        AssertSafeTestDirectory(context.TestRoot, instanceRoot);

        var startInfo = new ProcessStartInfo
        {
            FileName = context.ServerExecutable,
            WorkingDirectory = context.ServerDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        string[] arguments =
        [
            "--environment", "test",
            "--instance-id", instanceId,
            "--data-root", Path.Combine(instanceRoot, "runtime"),
            "--https-port", httpsPort.ToString(),
            "--http-port", httpPort.ToString(),
            "--allow-insecure-http",
            "--tls-storage-dir", Path.Combine(instanceRoot, "tls"),
            "--upload-dir", uploadDirectory,
            "--history-db", Path.Combine(instanceRoot, "history.db")
        ];
        foreach (string argument in arguments) startInfo.ArgumentList.Add(argument);

        await using OwnedProcess parallel = OwnedProcess.Start(startInfo, "parallel test server");
        try
        {
            await WaitForHealthAsync(parallel, httpPort, "test");
            await using PipeConnection parallelPipe = await ConnectPipeAsync(
                $"LocalMediaTransferPipe.Test.{instanceId}",
                context.Token);
            if (original.HasExited)
            {
                throw new InvalidOperationException(
                    "Starting an isolated test instance terminated the original server.");
            }
        }
        finally
        {
            await parallel.StopAsync();
        }
    }

    private static async Task RunPowerShellServerSuiteAsync(
        HarnessContext context,
        bool skipLargeBoundaryTests)
    {
        string script = Path.Combine(context.RepoRoot, "tests", "test_server.ps1");
        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            WorkingDirectory = context.RepoRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(script);
        startInfo.ArgumentList.Add("-Port");
        startInfo.ArgumentList.Add(context.Port.ToString());
        startInfo.ArgumentList.Add("-Token");
        startInfo.ArgumentList.Add(context.Token);
        startInfo.ArgumentList.Add("-UploadDir");
        startInfo.ArgumentList.Add(context.UploadDirectory);
        startInfo.ArgumentList.Add("-ExpectedEnvironment");
        startInfo.ArgumentList.Add("test");
        if (skipLargeBoundaryTests)
        {
            startInfo.ArgumentList.Add("-SkipLargeBoundaryTests");
        }

        await using OwnedProcess suite = OwnedProcess.Start(startInfo, "HTTP suite", echoOutput: true);
        if (!await suite.WaitForExitAsync(TimeSpan.FromMinutes(15)))
        {
            await suite.StopAsync();
            throw new TimeoutException("Server integration suite exceeded 15 minutes.");
        }
        if (suite.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Server integration suite failed with exit code {suite.ExitCode}.{suite.FormatCapturedOutput()}");
        }
    }

    private static async Task AssertBenchmarkRoutesDisabledAsync(HarnessContext context)
    {
        using var http = CreateHttpClient(context);
        using var response = await http.PostAsJsonAsync(
            "/_dev/benchmark/runs/start",
            new { },
            JsonOptions);
        if (response.StatusCode != HttpStatusCode.NotFound)
        {
            throw new InvalidOperationException(
                $"Expected disabled benchmark route to return 404, got {(int)response.StatusCode}.");
        }
    }

    private static async Task VerifyPreflightAndHistoryAsync(HarnessContext context)
    {
        Console.WriteLine("Verifying pre-upload deduplication and transfer history...");
        using var http = CreateHttpClient(context);
        const string filename = "preflight-delete-check.bin";
        byte[] content = Encoding.UTF8.GetBytes("preflight-content-a");
        string hash = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();

        using (var multipart = new MultipartFormDataContent())
        {
            multipart.Add(new ByteArrayContent(content), "file", filename);
            using var response = await http.PostAsync("/upload_single", multipart);
            response.EnsureSuccessStatusCode();
        }

        async Task<string> GetActionAsync(string endpoint, object payload)
        {
            using var response = await http.PostAsJsonAsync(endpoint, payload, JsonOptions);
            string body = await response.Content.ReadAsStringAsync();
            response.EnsureSuccessStatusCode();
            using JsonDocument json = JsonDocument.Parse(body);
            return json.RootElement.GetProperty("files")[0]
                .GetProperty("action").GetString() ?? "";
        }

        string candidate = await GetActionAsync(
            "/upload/preflight",
            new { files = new[] { new { id = "one", name = filename, size = content.Length } } });
        if (candidate != "hash_required")
        {
            throw new InvalidOperationException("Existing file was not selected for preflight hashing.");
        }
        string verified = await GetActionAsync(
            "/upload/preflight/verify",
            new { files = new[] { new { id = "one", name = filename, size = content.Length, sha256 = hash } } });
        if (verified != "skip")
        {
            throw new InvalidOperationException("Verified duplicate was not skipped before upload.");
        }

        File.Delete(Path.Combine(context.UploadDirectory, filename));
        string afterDelete = await GetActionAsync(
            "/upload/preflight",
            new { files = new[] { new { id = "two", name = filename, size = content.Length } } });
        if (afterDelete != "upload")
        {
            throw new InvalidOperationException("Deleted file was falsely reported as a duplicate candidate.");
        }

        byte[] replacement = Encoding.UTF8.GetBytes("preflight-content-b");
        await File.WriteAllBytesAsync(
            Path.Combine(context.UploadDirectory, filename),
            replacement);
        string replacementHash = Convert.ToHexString(
            SHA256.HashData(replacement)).ToLowerInvariant();
        string conflict = await GetActionAsync(
            "/upload/preflight/verify",
            new { files = new[] { new { id = "three", name = filename, size = replacement.Length, sha256 = hash } } });
        if (conflict != "upload_name_conflict" || replacementHash == hash)
        {
            throw new InvalidOperationException("Changed same-name file was incorrectly skipped.");
        }

        var coldFiles = new List<string>();
        byte[] coldMatch = Array.Empty<byte>();
        const string coldMatchName = "cold-259.bin";
        for (int index = 0; index < 260; index++)
        {
            string coldName = $"cold-{index:D3}.bin";
            byte[] coldContent = Encoding.UTF8.GetBytes(
                $"cold-content-{index:D4}".PadRight(64, (char)('a' + index % 26)));
            await File.WriteAllBytesAsync(
                Path.Combine(context.UploadDirectory, coldName),
                coldContent);
            coldFiles.Add(coldName);
            if (coldName == coldMatchName)
            {
                coldMatch = coldContent;
            }
        }
        await Task.Delay(1100);
        string coldHash = Convert.ToHexString(
            SHA256.HashData(coldMatch)).ToLowerInvariant();
        string coldCandidate = await GetActionAsync(
            "/upload/preflight",
            new
            {
                files = new object[]
                {
                    new { id = "cold", name = "renamed-cold.bin", size = coldMatch.Length }
                }
            });
        if (coldCandidate != "hash_required")
        {
            throw new InvalidOperationException(
                "Cold inventory did not expose a same-size duplicate candidate.");
        }
        using (var coldResponse = await http.PostAsJsonAsync(
            "/upload/preflight/verify",
            new
            {
                files = new[]
                {
                    new
                    {
                        id = "cold",
                        name = "renamed-cold.bin",
                        size = coldMatch.Length,
                        sha256 = coldHash
                    }
                }
            },
            JsonOptions))
        {
            string body = await coldResponse.Content.ReadAsStringAsync();
            coldResponse.EnsureSuccessStatusCode();
            using JsonDocument coldJson = JsonDocument.Parse(body);
            JsonElement result = coldJson.RootElement.GetProperty("files")[0];
            if (result.GetProperty("action").GetString() != "skip" ||
                result.GetProperty("filename").GetString() != coldMatchName)
            {
                throw new InvalidOperationException(
                    "A duplicate after the first 256 cold candidates was not verified deterministically.");
            }
        }
        foreach (string coldName in coldFiles)
        {
            File.Delete(Path.Combine(context.UploadDirectory, coldName));
        }

        long completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        using (var historyResponse = await http.PostAsJsonAsync(
            "/transfer_history",
            new
            {
                sessionId = "history-test",
                completedAt,
                selectedAssets = 1,
                expandedFiles = 3,
                selectedFiles = 3,
                uploadedFiles = 1,
                skippedFiles = 2,
                failedFiles = 0,
                selectedBytes = content.Length,
                selectedMediaBytes = content.Length / 2,
                additionalComponentsBytes = content.Length - content.Length / 2,
                selectedMediaFiles = 1,
                additionalComponentsFiles = 2,
                uploadedBytes = content.Length,
                skippedBytes = content.Length * 2,
                avoidedBytes = content.Length,
                finalizationDuplicateBytes = content.Length,
                checkDurationMs = 10,
                uploadDurationMs = 20,
                totalDurationMs = 30,
                averageSpeedMBps = 1.0,
                peakSpeedMBps = 2.0,
                retries = 0,
                files = new object[]
                {
                    new
                    {
                        id = "history-file",
                        name = filename,
                        savedName = filename,
                        size = content.Length,
                        outcome = "uploaded"
                    },
                    new
                    {
                        id = "history-skip",
                        name = "renamed-history.bin",
                        savedName = filename,
                        matchedName = filename,
                        size = content.Length,
                        outcome = "skipped",
                        duplicateStage = "preflight",
                        avoidedBytes = content.Length
                    },
                    new
                    {
                        id = "history-finalization-skip",
                        name = "late-duplicate.bin",
                        savedName = filename,
                        matchedName = filename,
                        size = content.Length,
                        outcome = "skipped",
                        duplicateStage = "finalization",
                        avoidedBytes = 0
                    }
                }
            },
            JsonOptions))
        {
            historyResponse.EnsureSuccessStatusCode();
        }
        using var recent = await http.GetAsync("/transfer_history/recent");
        string recentBody = await recent.Content.ReadAsStringAsync();
        recent.EnsureSuccessStatusCode();
        using JsonDocument recentJson = JsonDocument.Parse(recentBody);
        JsonElement historyItem = recentJson.RootElement.EnumerateArray().FirstOrDefault(
            item => item.GetProperty("sessionId").GetString() == "history-test");
        if (historyItem.ValueKind == JsonValueKind.Undefined)
        {
            throw new InvalidOperationException("Transfer history session was not persisted.");
        }
        JsonElement skippedHistory = historyItem.GetProperty("files")
            .EnumerateArray()
            .First(item => item.GetProperty("id").GetString() == "history-skip");
        if (historyItem.GetProperty("selectedAssets").GetInt32() != 1 ||
            historyItem.GetProperty("expandedFiles").GetInt32() != 3 ||
            historyItem.GetProperty("selectedMediaBytes").GetInt64() != content.Length / 2 ||
            historyItem.GetProperty("additionalComponentsBytes").GetInt64() != content.Length - content.Length / 2 ||
            historyItem.GetProperty("selectedMediaFiles").GetInt32() != 1 ||
            historyItem.GetProperty("additionalComponentsFiles").GetInt32() != 2 ||
            historyItem.GetProperty("avoidedBytes").GetInt64() != content.Length ||
            historyItem.GetProperty("finalizationDuplicateBytes").GetInt64() != content.Length ||
            skippedHistory.GetProperty("matchedName").GetString() != filename ||
            skippedHistory.GetProperty("avoidedBytes").GetInt64() != content.Length)
        {
            throw new InvalidOperationException(
                "Transfer history did not retain media-expansion or duplicate details.");
        }
    }

    private static async Task<string> SeedPersistenceAsync(HarnessContext context)
    {
        byte[] content = Encoding.UTF8.GetBytes($"persistence-{Path.GetFileName(context.UploadDirectory)}");
        string hash = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();

        using var http = CreateHttpClient(context);
        using var multipart = new MultipartFormDataContent();
        using var file = new ByteArrayContent(content);
        file.Headers.ContentType = new("application/octet-stream");
        multipart.Add(file, "file", "restart-persistence.txt");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/upload_single")
        {
            Content = multipart
        };
        using HttpResponseMessage response = await http.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        using JsonDocument json = JsonDocument.Parse(body);
        if (!json.RootElement.GetProperty("success").GetBoolean())
        {
            throw new InvalidOperationException("Unable to seed restart persistence verification.");
        }
        return hash;
    }

    private static async Task VerifyPersistenceAsync(HarnessContext context, string hash)
    {
        using var http = CreateHttpClient(context);
        using var response = await http.PostAsJsonAsync("/check_file", new { hash }, JsonOptions);
        string body = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        using JsonDocument json = JsonDocument.Parse(body);
        if (!json.RootElement.GetProperty("exists").GetBoolean())
        {
            throw new InvalidOperationException(
                "SQLite duplicate data did not survive a server restart.");
        }
    }

    private static async Task VerifyHistoryPersistenceAsync(HarnessContext context)
    {
        using var http = CreateHttpClient(context);
        using var response = await http.GetAsync("/transfer_history/recent");
        string body = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        using JsonDocument json = JsonDocument.Parse(body);
        if (!json.RootElement.EnumerateArray().Any(
                item => item.GetProperty("sessionId").GetString() == "history-test"))
        {
            throw new InvalidOperationException(
                "Transfer history did not survive a server restart.");
        }
    }

    private static async Task<string> VerifyHttpsAsync(
        HarnessContext context,
        string expectedEnvironment = "test")
    {
        string certificatePath = Path.Combine(context.TlsDirectory, "server-cert.pem");
        if (!File.Exists(certificatePath)) throw new InvalidOperationException("TLS certificate was not persisted in the isolated directory.");
        using var certificate = X509Certificate2.CreateFromPem(File.ReadAllText(certificatePath));
        string fingerprint = Convert.ToHexString(SHA256.HashData(certificate.RawData)).ToLowerInvariant();
        using var handler = new HttpClientHandler();
        handler.ServerCertificateCustomValidationCallback = (_, presented, _, _) =>
            presented != null && CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(presented.RawData), SHA256.HashData(certificate.RawData));
        using var client = new HttpClient(handler) { BaseAddress = new Uri($"https://127.0.0.1:{context.HttpsPort}"), Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.Add("X-Upload-Token", context.Token);
        using var response = await client.GetAsync("/_health");
        response.EnsureSuccessStatusCode();
        using JsonDocument body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        if (body.RootElement.GetProperty("environment").GetString() != expectedEnvironment)
            throw new InvalidOperationException("HTTPS health response reported the wrong environment.");
        return fingerprint;
    }

    private static async Task VerifyChangedFingerprintRejectedAsync(HarnessContext context)
    {
        Console.WriteLine("Verifying that a changed TLS certificate fingerprint is rejected...");
        string certificatePath = Path.Combine(context.TlsDirectory, "server-cert.pem");
        using var certificate = X509Certificate2.CreateFromPem(File.ReadAllText(certificatePath));
        byte[] changedFingerprint = SHA256.HashData(certificate.RawData);
        changedFingerprint[0] ^= 0x01;

        using var handler = new HttpClientHandler();
        handler.SslProtocols = SslProtocols.Tls12;
        handler.ServerCertificateCustomValidationCallback = (_, presented, _, _) =>
            presented != null && CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(presented.RawData), changedFingerprint);
        using var client = new HttpClient(handler)
        {
            BaseAddress = new Uri($"https://127.0.0.1:{context.HttpsPort}"),
            Timeout = TimeSpan.FromSeconds(10)
        };
        client.DefaultRequestHeaders.Add("X-Upload-Token", context.Token);

        try
        {
            using var response = await client.GetAsync("/_health");
            throw new InvalidOperationException(
                $"HTTPS accepted a changed certificate fingerprint with status {(int)response.StatusCode}.");
        }
        catch (HttpRequestException)
        {
            // Expected: the certificate callback rejects the TLS handshake.
        }
    }

    private static async Task AssertHttpFallbackClosedAsync(HarnessContext context)
    {
        using var client = new TcpClient(AddressFamily.InterNetwork);
        using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        try
        {
            await client.ConnectAsync(IPAddress.Loopback, context.Port, timeout.Token);
            throw new InvalidOperationException("HTTP fallback listener was open without explicit opt-in.");
        }
        catch (SocketException) { }
        catch (OperationCanceledException) { }
    }

    private static async Task VerifyTlsPolicyAsync(HarnessContext context)
    {
        string certificatePath = Path.Combine(context.TlsDirectory, "server-cert.pem");
        using var expected = X509Certificate2.CreateFromPem(File.ReadAllText(certificatePath));

        async Task AuthenticateAsync(SslProtocols protocols)
        {
            using var tcp = new TcpClient(AddressFamily.InterNetwork);
            await tcp.ConnectAsync(IPAddress.Loopback, context.HttpsPort);
            using var ssl = new SslStream(tcp.GetStream(), false, (_, certificate, _, _) =>
                certificate != null && CryptographicOperations.FixedTimeEquals(
                    SHA256.HashData(certificate.GetRawCertData()), SHA256.HashData(expected.RawData)));
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
            {
                TargetHost = "Local Media Transfer",
                EnabledSslProtocols = protocols,
                CertificateRevocationCheckMode = X509RevocationMode.NoCheck
            });
        }

        await AuthenticateAsync(SslProtocols.Tls12);
        try
        {
            await AuthenticateAsync(SslProtocols.Tls13);
            Console.WriteLine("TLS 1.3 negotiated successfully.");
        }
        catch (AuthenticationException)
        {
            Console.WriteLine("TLS 1.3 is unavailable through this Windows Schannel configuration; TLS 1.2 remains verified.");
        }
        catch (IOException)
        {
            Console.WriteLine("TLS 1.3 is unavailable through this Windows Schannel configuration; TLS 1.2 remains verified.");
        }
        try
        {
#pragma warning disable SYSLIB0039
            await AuthenticateAsync(SslProtocols.Tls11);
#pragma warning restore SYSLIB0039
            throw new InvalidOperationException("TLS 1.1 was unexpectedly accepted.");
        }
        catch (AuthenticationException) { }
        catch (IOException) { }
    }

    private static async Task VerifyDiscoveryAndPairingAsync(HarnessContext context, PipeConnection pipe)
    {
        Console.WriteLine("Verifying credential-free UDP discovery and approve-once pairing...");
        byte[] query = JsonSerializer.SerializeToUtf8Bytes(new { type = "lmt-discovery-query", version = 2 });
        using (var disabledUdp = new UdpClient(AddressFamily.InterNetwork))
        {
            await disabledUdp.SendAsync(
                query,
                query.Length,
                new IPEndPoint(IPAddress.Loopback, context.TestDiscoveryPort));
            using var disabledTimeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(400));
            try
            {
                await disabledUdp.ReceiveAsync(disabledTimeout.Token);
                throw new InvalidOperationException("UDP discovery answered before it was explicitly enabled.");
            }
            catch (OperationCanceledException) { }
            catch (SocketException ex) when (
                ex.SocketErrorCode == SocketError.ConnectionReset ||
                ex.SocketErrorCode == SocketError.ConnectionRefused) { }
        }

        await pipe.SendAcknowledgedCommandAsync("set_discovery_enabled", "true");
        await Task.Delay(250);
        JsonDocument? discoveryResponse = null;
        for (int attempt = 0; attempt < 5 && discoveryResponse == null; attempt++)
        {
            using var udp = new UdpClient(AddressFamily.InterNetwork);
            await udp.SendAsync(
                query,
                query.Length,
                new IPEndPoint(IPAddress.Loopback, context.TestDiscoveryPort));
            using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(750));
            try
            {
                UdpReceiveResult result = await udp.ReceiveAsync(timeout.Token);
                discoveryResponse = JsonDocument.Parse(result.Buffer);
            }
            catch (OperationCanceledException) when (attempt < 4) { await Task.Delay(150); }
        }
        using (discoveryResponse ?? throw new TimeoutException("UDP discovery did not answer repeated queries."))
        {
            JsonElement root = discoveryResponse.RootElement;
            if (root.GetProperty("type").GetString() != "lmt-discovery-response" ||
                root.GetProperty("version").GetInt32() != 2 ||
                root.GetProperty("httpsPort").GetInt32() != context.HttpsPort ||
                root.GetProperty("httpPort").GetInt32() != context.Port ||
                root.GetProperty("environment").GetString() != "test" ||
                root.GetProperty("certificateFingerprint").GetString()?.Length != 64 ||
                root.GetProperty("capabilities").GetProperty("nativeWindowsTransfer")
                    .GetProperty("version").GetInt32() != 1 ||
                root.GetProperty("capabilities").GetProperty("nativeWindowsTransfer")
                    .GetProperty("pairingAvailable").GetBoolean() ||
                root.TryGetProperty("token", out _) || root.TryGetProperty("credential", out _))
                throw new InvalidOperationException("UDP discovery response was invalid or exposed a token.");
        }

        const string deviceId = "harness-device";
        string credential = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        using var http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{context.Port}") };
        http.DefaultRequestHeaders.Add("X-Upload-Token", context.Token);
        using HttpResponseMessage pending = await http.PostAsJsonAsync("/pair/request", new
        {
            deviceId,
            deviceName = "Harness iPhone",
            credential
        }, JsonOptions);
        pending.EnsureSuccessStatusCode();
        using JsonDocument pendingBody = JsonDocument.Parse(await pending.Content.ReadAsStringAsync());
        if (pendingBody.RootElement.GetProperty("status").GetString() != "pending" ||
            pendingBody.RootElement.GetProperty("environment").GetString() != "test")
            throw new InvalidOperationException("Unknown pairing request was not pending.");

        string replacementCredential = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        using HttpResponseMessage replacementPending = await http.PostAsJsonAsync("/pair/request", new
        {
            deviceId,
            deviceName = "Harness iPhone",
            credential = replacementCredential
        }, JsonOptions);
        replacementPending.EnsureSuccessStatusCode();
        using JsonDocument replacementPendingBody = JsonDocument.Parse(await replacementPending.Content.ReadAsStringAsync());
        if (replacementPendingBody.RootElement.GetProperty("status").GetString() != "pending" ||
            replacementPendingBody.RootElement.GetProperty("environment").GetString() != "test")
            throw new InvalidOperationException("Replacement pairing request was not pending.");
        credential = replacementCredential;

        await pipe.SendAcknowledgedCommandAsync("approve_device", deviceId);
        using HttpResponseMessage status = await http.PostAsJsonAsync("/pair/status", new { deviceId, credential }, JsonOptions);
        status.EnsureSuccessStatusCode();
        using JsonDocument statusBody = JsonDocument.Parse(await status.Content.ReadAsStringAsync());
        if (statusBody.RootElement.GetProperty("status").GetString() != "approved" ||
            statusBody.RootElement.GetProperty("environment").GetString() != "test")
            throw new InvalidOperationException("Approved device did not become authorized.");

        using HttpResponseMessage unknownStatus = await http.PostAsJsonAsync(
            "/pair/status",
            new
            {
                deviceId = "unknown-device",
                credential = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant()
            },
            JsonOptions);
        if (unknownStatus.StatusCode != HttpStatusCode.Forbidden)
            throw new InvalidOperationException("Unknown pairing status did not fail closed.");
        using JsonDocument unknownStatusBody = JsonDocument.Parse(await unknownStatus.Content.ReadAsStringAsync());
        if (unknownStatusBody.RootElement.GetProperty("status").GetString() != "denied" ||
            unknownStatusBody.RootElement.GetProperty("environment").GetString() != "test")
            throw new InvalidOperationException("Unknown pairing status was not denied.");

        using var verify = new HttpRequestMessage(HttpMethod.Post, "/verify_token");
        verify.Headers.Add("X-Upload-Token", credential);
        using HttpResponseMessage verified = await http.SendAsync(verify);
        verified.EnsureSuccessStatusCode();
        using JsonDocument verifiedBody = JsonDocument.Parse(await verified.Content.ReadAsStringAsync());
        if (verifiedBody.RootElement.GetProperty("environment").GetString() != "test")
            throw new InvalidOperationException("Token verification omitted the test environment.");
    }

    private static async Task VerifyNativeWindowsTransferAsync(
        HarnessContext context, PipeConnection pipe)
    {
        Console.WriteLine("Verifying native Windows pairing and scoped transfer grants...");
        using HttpClient http = CreatePinnedHttpsClient(context);
        using JsonDocument identity = await GetJsonAsync(http, "/native/v1/identity");
        string serverId = identity.RootElement.GetProperty("serverId").GetString()!;
        string fingerprint = identity.RootElement.GetProperty("certificateFingerprint").GetString()!;
        const string clientId = "11111111-2222-3333-4444-555555555555";
        string credential = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        string nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        object pairingBody = new
        {
            protocolVersion = 1,
            environment = "test",
            serverId,
            clientId,
            clientName = "Harness Windows sender",
            clientNonce = nonce,
            credential
        };

        using HttpResponseMessage closed = await http.PostAsJsonAsync(
            "/native/v1/pairing/requests", pairingBody, JsonOptions);
        AssertEqual(HttpStatusCode.Forbidden, closed.StatusCode,
            "Native pairing succeeded while its receiver window was closed.");
        using JsonDocument closedBody = JsonDocument.Parse(await closed.Content.ReadAsStringAsync());
        AssertEqual("pairing_window_closed", closedBody.RootElement.GetProperty("error").GetString(),
            "Closed pairing window returned an unstable error code.");

        await pipe.SendAcknowledgedCommandAsync("begin_native_pairing", "120");
        using HttpResponseMessage pending = await http.PostAsJsonAsync(
            "/native/v1/pairing/requests", pairingBody, JsonOptions);
        pending.EnsureSuccessStatusCode();
        using JsonDocument pendingBody = JsonDocument.Parse(await pending.Content.ReadAsStringAsync());
        string requestId = pendingBody.RootElement.GetProperty("requestId").GetString()!;
        string proof = ComputeNativePairingProof(credential, requestId, nonce);
        using HttpResponseMessage confirmed = await http.PostAsJsonAsync(
            $"/native/v1/pairing/requests/{requestId}/confirm", new { proof }, JsonOptions);
        confirmed.EnsureSuccessStatusCode();
        await pipe.SendAcknowledgedCommandAsync("approve_native_pairing", requestId);
        using HttpResponseMessage approved = await http.PostAsJsonAsync(
            $"/native/v1/pairing/requests/{requestId}/status",
            new { clientId, credential }, JsonOptions);
        approved.EnsureSuccessStatusCode();
        using JsonDocument approvedBody = JsonDocument.Parse(await approved.Content.ReadAsStringAsync());
        AssertEqual("approved", approvedBody.RootElement.GetProperty("status").GetString(),
            "Native Windows credential was not trusted after two-sided approval.");

        using (var directUpload = new HttpRequestMessage(HttpMethod.Post, "/upload/preflight")
        {
            Content = JsonContent.Create(new
            {
                files = new[] { new { id = "direct", name = "direct.bin", size = 3 } }
            })
        })
        {
            directUpload.Headers.Add("X-Upload-Token", credential);
            using HttpResponseMessage rejected = await http.SendAsync(directUpload);
            AssertEqual(HttpStatusCode.Forbidden, rejected.StatusCode,
                "A Windows long-term credential directly authorized an upload route.");
        }

        string sessionId = "win-" + Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        string fileId = sessionId + "-" + Convert.ToHexString(
            RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        using var transferRequest = new HttpRequestMessage(HttpMethod.Post,
            "/native/v1/transfers/requests")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = 1,
                clientSessionId = sessionId,
                skipExactDuplicates = true,
                files = new[] { new { fileId, name = "native-harness.bin", sizeBytes = 3 } }
            })
        };
        transferRequest.Headers.Add("X-Device-Credential", credential);
        using HttpResponseMessage transferPending = await http.SendAsync(transferRequest);
        transferPending.EnsureSuccessStatusCode();
        using JsonDocument transferPendingBody = JsonDocument.Parse(
            await transferPending.Content.ReadAsStringAsync());
        string transferRequestId = transferPendingBody.RootElement.GetProperty("requestId").GetString()!;
        string transferId = transferPendingBody.RootElement.GetProperty("transferId").GetString()!;
        AssertEqual(sessionId[4..], transferId,
            "Receiver transfer ID was not bound to the client session ID.");
        await pipe.SendAcknowledgedCommandAsync("approve_native_transfer", transferRequestId);
        using var statusRequest = new HttpRequestMessage(HttpMethod.Post,
            $"/native/v1/transfers/requests/{transferRequestId}/status");
        statusRequest.Headers.Add("X-Device-Credential", credential);
        using HttpResponseMessage transferStatus = await http.SendAsync(statusRequest);
        transferStatus.EnsureSuccessStatusCode();
        using JsonDocument statusBody = JsonDocument.Parse(await transferStatus.Content.ReadAsStringAsync());
        string grant = statusBody.RootElement.GetProperty("token").GetString()!;

        using JsonDocument preflight = await PostNativePreflightAsync(http,
            transferId, grant, fileId, "native-harness.bin", 3);
        AssertEqual("upload", preflight.RootElement.GetProperty("files")[0]
            .GetProperty("action").GetString(), "Scoped grant did not authorize its manifest file.");
        try
        {
            using JsonDocument _ = await PostNativePreflightAsync(http,
                transferId, grant, fileId + "-unknown", "native-harness.bin", 3);
            throw new InvalidOperationException("Scoped grant authorized an unknown file ID.");
        }
        catch (HttpRequestException exception) when (
            exception.StatusCode == HttpStatusCode.Forbidden) { }

        using var cancel = new HttpRequestMessage(HttpMethod.Post,
            $"/native/v1/transfers/{transferId}/cancel");
        cancel.Headers.Add("X-Upload-Token", grant);
        using HttpResponseMessage cancelled = await http.SendAsync(cancel);
        cancelled.EnsureSuccessStatusCode();
        try
        {
            using JsonDocument _ = await PostNativePreflightAsync(http,
                transferId, grant, fileId, "native-harness.bin", 3);
            throw new InvalidOperationException("Cancelled transfer grant remained active.");
        }
        catch (HttpRequestException exception) when (
            exception.StatusCode == HttpStatusCode.Forbidden) { }

        await pipe.SendAcknowledgedCommandAsync("revoke_device", clientId);
        using var revokedRequest = new HttpRequestMessage(HttpMethod.Post,
            "/native/v1/transfers/requests")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = 1,
                clientSessionId = "win-" + new string('a', 32),
                skipExactDuplicates = true,
                files = new[] { new { fileId = "win-" + new string('a', 32) + "-file",
                    name = "revoked.bin", sizeBytes = 1 } }
            })
        };
        revokedRequest.Headers.Add("X-Device-Credential", credential);
        using HttpResponseMessage revoked = await http.SendAsync(revokedRequest);
        AssertEqual(HttpStatusCode.Unauthorized, revoked.StatusCode,
            "Revoked Windows credential still requested a transfer.");

        // The sender computes the display code independently; the receiver never
        // returns it through HTTP. Keep the fingerprint in this computation so a
        // certificate change necessarily changes the code.
        Assert(ComputeNativeSecurityCode("test", serverId, fingerprint,
            clientId, nonce, requestId).Length == 9,
            "Native pairing security code format is invalid.");
        await pipe.SendAcknowledgedCommandAsync("end_native_pairing", "");
        VerifyNativeDiagnosticPrivacy(context,
            [credential, nonce, clientId, requestId, transferRequestId, transferId,
                fileId, fingerprint, "Harness Windows sender", "native-harness.bin"]);
    }

    private static void VerifyNativeDiagnosticPrivacy(HarnessContext context,
        IReadOnlyList<string> forbiddenValues)
    {
        string logPath = Path.Combine(context.RuntimeDataDirectory, "logs", "server.log");
        using FileStream stream = new(logPath, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        using var reader = new StreamReader(stream);
        string[] lines = reader.ReadToEnd().Split(new[] { "\r\n", "\n" },
            StringSplitOptions.None).Where(line =>
            line.Contains("[native_windows_diagnostic]", StringComparison.Ordinal)).ToArray();
        string combined = string.Join('\n', lines);
        foreach (string eventName in new[]
        {
            "receiver_server_started", "pairing_window_opened", "pairing_requested",
            "pairing_confirmed", "pairing_approved", "transfer_requested",
            "transfer_approved", "transfer_cancelled", "device_revoked",
            "pairing_window_closed"
        })
        {
            if (!combined.Contains($"\"event\":\"{eventName}\"", StringComparison.Ordinal))
                throw new InvalidOperationException(
                    $"Native receiver diagnostics omitted '{eventName}'.");
        }
        foreach (string value in forbiddenValues.Where(value => !string.IsNullOrEmpty(value)))
        {
            if (combined.Contains(value, StringComparison.Ordinal))
                throw new InvalidOperationException(
                    "Native receiver diagnostics exposed a forbidden identity or transfer field.");
        }
    }

    private static async Task<JsonDocument> PostNativePreflightAsync(HttpClient http,
        string transferId, string grant, string fileId, string name, long size)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/upload/preflight")
        {
            Content = JsonContent.Create(new { files = new[] { new { id = fileId, name, size } } })
        };
        request.Headers.Add("X-Upload-Token", grant);
        request.Headers.Add("X-Transfer-Id", transferId);
        request.Headers.Add("X-Skip-Duplicates", "true");
        using HttpResponseMessage response = await http.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(body, null, response.StatusCode);
        return JsonDocument.Parse(body);
    }

    private static string ComputeNativePairingProof(string credential,
        string requestId, string nonce)
    {
        byte[] canonical = NativeCanonical("LMT-WINDOWS-PAIR-CONFIRM-V1", requestId, nonce);
        using var hmac = new HMACSHA256(Convert.FromHexString(credential));
        return Convert.ToHexString(hmac.ComputeHash(canonical)).ToLowerInvariant();
    }

    private static string ComputeNativeSecurityCode(params string[] values)
    {
        byte[] digest = SHA256.HashData(NativeCanonical(
            new[] { "LMT-WINDOWS-PAIR-V1" }.Concat(values).ToArray()));
        uint prefix = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(digest);
        string digits = (prefix % 100_000_000U).ToString("D8");
        return digits[..4] + " " + digits[4..];
    }

    private static byte[] NativeCanonical(params string[] values)
    {
        using var stream = new MemoryStream();
        byte[] length = new byte[4];
        foreach (string value in values)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(value);
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(length,
                checked((uint)bytes.Length));
            stream.Write(length); stream.Write(bytes);
        }
        return stream.ToArray();
    }

    private static async Task VerifyHistoryDeletionAsync(
        HarnessContext context,
        PipeConnection pipe)
    {
        using var http = CreateHttpClient(context);

        byte[] encodedChunkContent = Encoding.UTF8.GetBytes("base64-ios-chunk");
        string encodedChunkName = "ios-base64-regression.bin";
        using (var encodedRequest = new HttpRequestMessage(HttpMethod.Post, "/upload_chunk"))
        {
            encodedRequest.Headers.Add("X-File-Id", "ios-base64-regression");
            encodedRequest.Headers.Add("X-Filename", Uri.EscapeDataString(encodedChunkName));
            encodedRequest.Headers.Add("X-Chunk-Index", "0");
            encodedRequest.Headers.Add("X-Total-Chunks", "1");
            encodedRequest.Headers.Add("X-File-Size", encodedChunkContent.Length.ToString());
            encodedRequest.Headers.Add("X-Content-Transfer-Encoding", "base64");
            string encoded = Convert.ToBase64String(encodedChunkContent);
            string wrappedEncoded = string.Join("\r\n", Enumerable.Range(0, (encoded.Length + 3) / 4)
                .Select(index => encoded.Substring(index * 4, Math.Min(4, encoded.Length - index * 4))));
            encodedRequest.Content = new StringContent(wrappedEncoded);
            using HttpResponseMessage encodedResponse = await http.SendAsync(encodedRequest);
            encodedResponse.EnsureSuccessStatusCode();
            using JsonDocument timingBody = JsonDocument.Parse(await encodedResponse.Content.ReadAsStringAsync());
            if (!timingBody.RootElement.TryGetProperty("serverWriteDurationMs", out JsonElement writeTiming) ||
                !timingBody.RootElement.TryGetProperty("serverFinalizeDurationMs", out JsonElement finalizeTiming) ||
                writeTiming.GetDouble() < 0 || finalizeTiming.GetDouble() < 0)
            {
                throw new InvalidOperationException("Chunk response did not contain real non-negative server timings.");
            }
        }
        byte[] savedEncodedChunk = await File.ReadAllBytesAsync(
            Path.Combine(context.UploadDirectory, encodedChunkName));
        if (!savedEncodedChunk.SequenceEqual(encodedChunkContent))
        {
            throw new InvalidOperationException("Base64 iOS chunk was not decoded exactly.");
        }

        using (var resetRequest = new HttpRequestMessage(HttpMethod.Post, "/client_log"))
        {
            resetRequest.Content = JsonContent.Create(new
            {
                session = "metrics-reset-test",
                level = "INFO",
                @event = "transfer_started",
                message = "new transfer"
            });
            using HttpResponseMessage resetResponse = await http.SendAsync(resetRequest);
            resetResponse.EnsureSuccessStatusCode();
        }
        _ = await pipe.WaitForMetricsAsync(
            metrics => metrics.GetProperty("filesTransferred").GetInt64() == 0 &&
                       metrics.GetProperty("totalBytes").GetInt64() == 0 &&
                       metrics.GetProperty("isActive").GetBoolean(),
            TimeSpan.FromSeconds(5));

        using (HttpResponseMessage speedResponse = await http.PostAsJsonAsync(
            "/client_metrics",
            new { sessionId = "metrics-reset-test", bytesPerSecond = 20_000_000 }))
        {
            speedResponse.EnsureSuccessStatusCode();
            using JsonDocument speedBody = JsonDocument.Parse(await speedResponse.Content.ReadAsStringAsync());
            if (!speedBody.RootElement.GetProperty("accepted").GetBoolean())
            {
                throw new InvalidOperationException("Current-session client speed was rejected.");
            }
        }
        _ = await pipe.WaitForMetricsAsync(
            metrics => Math.Abs(metrics.GetProperty("speedMBps").GetDouble() - 20.0) < 0.01,
            TimeSpan.FromSeconds(5));

        using (HttpResponseMessage staleResponse = await http.PostAsJsonAsync(
            "/client_metrics",
            new { sessionId = "stale-ios-session", bytesPerSecond = 90_000_000 }))
        {
            staleResponse.EnsureSuccessStatusCode();
            using JsonDocument staleBody = JsonDocument.Parse(await staleResponse.Content.ReadAsStringAsync());
            if (staleBody.RootElement.GetProperty("accepted").GetBoolean())
            {
                throw new InvalidOperationException("A stale transfer overwrote the active speed metric.");
            }
        }

        using (var completeRequest = new HttpRequestMessage(HttpMethod.Post, "/client_log"))
        {
            completeRequest.Content = JsonContent.Create(new
            {
                session = "metrics-reset-test",
                level = "INFO",
                @event = "transfer_completed",
                message = "transfer complete"
            });
            using HttpResponseMessage completeResponse = await http.SendAsync(completeRequest);
            completeResponse.EnsureSuccessStatusCode();
        }
        _ = await pipe.WaitForMetricsAsync(
            metrics => !metrics.GetProperty("isActive").GetBoolean() &&
                       Math.Abs(metrics.GetProperty("speedMBps").GetDouble()) < 0.01,
            TimeSpan.FromSeconds(5));

        using var delete = await http.DeleteAsync("/transfer_history");
        delete.EnsureSuccessStatusCode();

        using var response = await http.GetAsync("/transfer_history/recent");
        response.EnsureSuccessStatusCode();
        using JsonDocument json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        if (json.RootElement.GetArrayLength() != 0)
        {
            throw new InvalidOperationException("Transfer history DELETE did not clear persisted sessions.");
        }
    }

    private static async Task<string> VerifyBenchmarkModeAsync(HarnessContext context)
    {
        using var http = CreateHttpClient(context);
        string runId = await StartBenchmarkRunAsync(http, context);

        using HttpResponseMessage conflict = await PostJsonAsync(
            http,
            "/_dev/benchmark/runs/start",
            BuildStartPayload(context));
        if (conflict.StatusCode != HttpStatusCode.Conflict)
        {
            throw new InvalidOperationException(
                $"Expected second benchmark start to return 409, got {(int)conflict.StatusCode}.");
        }

        using HttpResponseMessage sample = await PostJsonAsync(
            http,
            $"/_dev/benchmark/runs/{runId}/samples",
            new
            {
                elapsedMs = 1000,
                throughputMBps = 12.5,
                cpuPercent = 10,
                workingSetBytes = 4096,
                processIoReadBytes = 1024,
                processIoWriteBytes = 2048,
                networkBytes = 3000,
                transferredBytes = 4096
            });
        sample.EnsureSuccessStatusCode();

        byte[] integrityContent = Encoding.UTF8.GetBytes(
            $"benchmark-integrity-{Path.GetFileName(context.UploadDirectory)}");
        const string integrityFileName = "benchmark-integrity.bin";
        await File.WriteAllBytesAsync(
            Path.Combine(context.UploadDirectory, integrityFileName),
            integrityContent);
        string expectedSha256 = Convert.ToHexString(
            SHA256.HashData(integrityContent)).ToLowerInvariant();

        using HttpResponseMessage verify = await PostJsonAsync(
            http,
            $"/_dev/benchmark/runs/{runId}/files/integrity-file/verify",
            new
            {
                sourceName = integrityFileName,
                savedName = integrityFileName,
                sizeBytes = integrityContent.LongLength,
                uploadMode = "test",
                durationMs = 10,
                throughputMBps = 1.0,
                retries = 0,
                httpStatus = 200,
                expectedSha256,
                error = ""
            });
        verify.EnsureSuccessStatusCode();

        using HttpResponseMessage finish = await PostJsonAsync(
            http,
            $"/_dev/benchmark/runs/{runId}/finish",
            new
            {
                totalBytes = 4096,
                totalFiles = 1,
                durationMs = 1000,
                averageMBps = 0.004,
                peakMBps = 12.5,
                p50MBps = 12.5,
                p95MBps = 12.5,
                p99MBps = 12.5,
                retries = 0,
                errors = 0,
                integrityOk = true,
                notes = "complete",
                status = "completed"
            });
        finish.EnsureSuccessStatusCode();

        JsonDocument stored = await GetJsonAsync(http, $"/_dev/benchmark/runs/{runId}");
        using (stored)
        {
            JsonElement root = stored.RootElement;
            if (root.GetProperty("status").GetString() != "completed" ||
                root.GetProperty("samples").GetArrayLength() != 1 ||
                root.GetProperty("files").GetArrayLength() != 1 ||
                !root.GetProperty("files")[0].GetProperty("integrityOk").GetBoolean() ||
                root.GetProperty("machine").GetProperty("cpuName").GetString() != "test")
            {
                throw new InvalidOperationException(
                    "Completed benchmark data, hardware, or integrity results could not be read back.");
            }
        }

        if (!File.Exists(context.BenchmarkDatabase))
        {
            throw new InvalidOperationException(
                "Benchmark database was not created at the requested path.");
        }
        return runId;
    }

    private static async Task VerifyBenchmarkPersistenceAsync(
        HarnessContext context,
        string runId)
    {
        using var http = CreateHttpClient(context);
        using JsonDocument stored =
            await GetJsonAsync(http, $"/_dev/benchmark/runs/{runId}");
        JsonElement root = stored.RootElement;
        if (root.GetProperty("id").GetString() != runId ||
            root.GetProperty("status").GetString() != "completed" ||
            root.GetProperty("samples").GetArrayLength() != 1 ||
            root.GetProperty("files").GetArrayLength() != 1 ||
            !root.GetProperty("files")[0].GetProperty("integrityOk").GetBoolean() ||
            root.GetProperty("machine").GetProperty("fingerprint").GetString() !=
                $"test-{Path.GetFileName(context.UploadDirectory)}")
        {
            throw new InvalidOperationException(
                "Benchmark run data did not survive server restart.");
        }
    }

    private static async Task RunBenchmarkRunnerAsync(
        HarnessContext context,
        string profile)
    {
        string runnerDll = Path.Combine(
            context.RepoRoot,
            "tools",
            "LocalMediaTransfer.Benchmarks",
            "bin",
            "Release",
            "net8.0",
            "LocalMediaTransfer.Benchmarks.dll");
        if (!File.Exists(runnerDll))
        {
            throw new FileNotFoundException(
                "Release benchmark runner was not found. Build " +
                "tools/LocalMediaTransfer.Benchmarks before running benchmark smoke.",
                runnerDll);
        }

        string exportDirectory = Path.Combine(context.UploadDirectory, "exports");
        var startInfo = new ProcessStartInfo
        {
            FileName = "dotnet",
            WorkingDirectory = context.RepoRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.ArgumentList.Add(runnerDll);
        startInfo.ArgumentList.Add("--profile");
        startInfo.ArgumentList.Add(profile);
        startInfo.ArgumentList.Add("--server");
        startInfo.ArgumentList.Add($"http://127.0.0.1:{context.Port}");
        startInfo.ArgumentList.Add("--token");
        startInfo.ArgumentList.Add(context.Token);
        startInfo.ArgumentList.Add("--transport");
        startInfo.ArgumentList.Add("loopback");
        startInfo.ArgumentList.Add("--build-configuration");
        startInfo.ArgumentList.Add("Release");
        startInfo.ArgumentList.Add("--export-dir");
        startInfo.ArgumentList.Add(exportDirectory);
        startInfo.ArgumentList.Add("--notes");
        startInfo.ArgumentList.Add($"isolated harness {profile}");

        await using OwnedProcess runner = OwnedProcess.Start(
            startInfo,
            "benchmark runner",
            echoOutput: true);
        if (!await runner.WaitForExitAsync(TimeSpan.FromMinutes(10)))
        {
            await runner.StopAsync();
            throw new TimeoutException(
                $"Benchmark profile '{profile}' exceeded 10 minutes.");
        }
        if (runner.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Benchmark runner failed with exit code {runner.ExitCode}." +
                runner.FormatCapturedOutput());
        }

        string[] jsonFiles = Directory.GetFiles(exportDirectory, "*.json");
        string[] csvFiles = Directory.GetFiles(exportDirectory, "*.csv");
        int expectedRuns = profile == "standard" ? 4 : 1;
        int expectedFilesPerRun = profile == "standard" ? 22 : 6;
        if (jsonFiles.Length != expectedRuns || csvFiles.Length != expectedRuns)
        {
            throw new InvalidOperationException(
                $"Benchmark profile '{profile}' did not create {expectedRuns} " +
                "JSON and CSV export pair(s).");
        }

        foreach (string jsonFile in jsonFiles)
        {
            using JsonDocument export = JsonDocument.Parse(
                await File.ReadAllTextAsync(jsonFile));
            JsonElement root = export.RootElement;
            if (root.GetProperty("files").GetArrayLength() != expectedFilesPerRun ||
                !root.GetProperty("files").EnumerateArray()
                    .All(file => file.GetProperty("integrityOk").GetBoolean()) ||
                string.IsNullOrWhiteSpace(
                    root.GetProperty("machine").GetProperty("cpuName").GetString()))
            {
                throw new InvalidOperationException(
                    "Benchmark export is missing file integrity or machine metadata.");
            }
        }
    }

    private static async Task<string> StartBenchmarkRunAsync(
        HttpClient http,
        HarnessContext context)
    {
        using HttpResponseMessage response = await PostJsonAsync(
            http,
            "/_dev/benchmark/runs/start",
            BuildStartPayload(context));
        string body = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        using JsonDocument json = JsonDocument.Parse(body);
        string? runId = json.RootElement.GetProperty("runId").GetString();
        return string.IsNullOrWhiteSpace(runId)
            ? throw new InvalidOperationException("Benchmark start did not return a run ID.")
            : runId;
    }

    private static object BuildStartPayload(HarnessContext context) => new
    {
        machine = new
        {
            fingerprint = $"test-{Path.GetFileName(context.UploadDirectory)}",
            osName = "Windows Test",
            osVersion = "test",
            cpuName = "test",
            physicalCores = 1,
            logicalCores = 1,
            ramBytes = 1024,
            nicName = "loopback",
            nicLinkMbps = 1000,
            storageModel = "temporary",
            storageType = "test"
        },
        gitCommit = "test",
        serverVersion = "test",
        clientVersion = "test",
        buildConfiguration = "Debug",
        profile = "harness",
        transport = "loopback",
        chunkSizeBytes = 4096,
        fileConcurrency = 1,
        networkBaselineMbps = 1000,
        notes = "isolated harness"
    };

    private static HttpClient CreateHttpClient(HarnessContext context)
    {
        var http = new HttpClient
        {
            BaseAddress = new Uri($"http://127.0.0.1:{context.Port}"),
            Timeout = TimeSpan.FromSeconds(30)
        };
        http.DefaultRequestHeaders.Add("X-Upload-Token", context.Token);
        return http;
    }

    private static HttpClient CreatePinnedHttpsClient(HarnessContext context)
    {
        string certificatePath = Path.Combine(context.TlsDirectory, "server-cert.pem");
        using var certificate = X509Certificate2.CreateFromPem(File.ReadAllText(certificatePath));
        byte[] expected = SHA256.HashData(certificate.RawData);
        var handler = new HttpClientHandler
        {
            SslProtocols = SslProtocols.Tls12,
            ServerCertificateCustomValidationCallback = (_, presented, _, _) =>
                presented is not null && CryptographicOperations.FixedTimeEquals(
                    expected, SHA256.HashData(presented.RawData))
        };
        return new HttpClient(handler)
        {
            BaseAddress = new Uri($"https://127.0.0.1:{context.HttpsPort}"),
            Timeout = TimeSpan.FromSeconds(30)
        };
    }

    private static Task<HttpResponseMessage> PostJsonAsync(
        HttpClient http,
        string path,
        object body) =>
        http.PostAsJsonAsync(path, body, JsonOptions);

    private static async Task<JsonDocument> GetJsonAsync(HttpClient http, string path)
    {
        using HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(body);
    }

    private static async Task StopServerAsync(OwnedProcess process)
    {
        await process.StopAsync();
        await process.DisposeAsync();
    }

    private static int GetEphemeralPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }

    private static string FindRepoRoot()
    {
        DirectoryInfo? current = new(Environment.CurrentDirectory);
        while (current is not null)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "src", "Server")) &&
                Directory.Exists(Path.Combine(current.FullName, "tests")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        throw new DirectoryNotFoundException(
            "Run the test harness from inside the LocalMediaTransfer repository.");
    }

    private static string ResolveServerExecutable(string requestedPath, string serverDirectory)
    {
        if (!string.IsNullOrWhiteSpace(requestedPath))
        {
            string resolved = Path.GetFullPath(requestedPath);
            return File.Exists(resolved)
                ? resolved
                : throw new FileNotFoundException("Server executable not found.", resolved);
        }

        string[] candidates =
        [
            Path.Combine(serverDirectory, "out", "build", "x64-debug", "bin", "LocalMediaTransferServer.exe"),
            Path.Combine(serverDirectory, "out", "build", "x64-Debug", "bin", "LocalMediaTransferServer.exe"),
            Path.Combine(serverDirectory, "out", "build", "x64-release", "bin", "LocalMediaTransferServer.exe"),
            Path.Combine(serverDirectory, "out", "build", "x64-Release", "bin", "LocalMediaTransferServer.exe"),
            Path.Combine(serverDirectory, "build", "bin", "LocalMediaTransferServer.exe")
        ];
        return candidates.FirstOrDefault(File.Exists) ??
               throw new FileNotFoundException(
                   $"LocalMediaTransferServer.exe not found. Checked: {string.Join(", ", candidates)}");
    }

    private static void AssertSafeTestDirectory(string testRoot, string path)
    {
        string root = Path.GetFullPath(testRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        string candidate = Path.GetFullPath(path)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Refusing test operation outside dedicated root '{root}': {candidate}");
        }
    }

    private static async Task DeleteDirectoryWithRetryAsync(
        string testRoot,
        string path)
    {
        AssertSafeTestDirectory(testRoot, path);
        Exception? lastError = null;
        for (int attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                Directory.Delete(path, recursive: true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                lastError = ex;
                if (attempt < 5)
                {
                    await Task.Delay(200);
                }
            }
        }
        throw new IOException(
            $"Failed to remove test directory after 5 attempts: {lastError?.Message}",
            lastError);
    }

    private static void VerifyClientLogPrivacy(HarnessContext context)
    {
        string logPath = Path.Combine(context.RuntimeDataDirectory, "logs", "server.log");
        if (!File.Exists(logPath))
        {
            throw new InvalidOperationException(
                "The isolated server log was not created for the client-log privacy check.");
        }

        string logText = File.ReadAllText(logPath);
        if (!logText.Contains("security_log_sanitization_probe", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "The authenticated client-log sanitization probe was not flushed.");
        }
        if (logText.Contains("LMT_CLIENT_LOG_SECRET_MARKER", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Sensitive client data was written to the isolated server log.");
        }
        if (!logText.Contains("[CLIENT][line-one  line-two]", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Client-log control characters were not neutralized.");
        }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void AssertEqual<T>(T expected, T actual, string message)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException(
                $"{message} Expected '{expected}', received '{actual}'.");
        }
    }
}

internal sealed record HarnessContext(
    string RepoRoot,
    string ServerDirectory,
    string ServerExecutable,
    string TestRoot,
    string RunId,
    string RunDirectory,
    string UploadDirectory,
    string RuntimeDataDirectory,
    string BenchmarkDatabase,
    string HistoryDatabase,
    int Port,
    int HttpsPort,
    string TlsDirectory,
    string Token)
{
    public string TestPipeName => $"LocalMediaTransferPipe.Test.{RunId}";
    public string BenchmarkPipeName => $"LocalMediaTransferPipe.Benchmark.{RunId}";
    public int TestDiscoveryPort => 45893;
}

internal sealed record HarnessOptions(
    string ServerExecutable,
    bool KeepArtifacts,
    bool SkipLargeBoundaryTests,
    string BenchmarkProfile,
    bool OwnershipOnly,
    bool ShowHelp)
{
    public static HarnessOptions Parse(string[] args)
    {
        string serverExecutable = "";
        bool keepArtifacts = false;
        bool skipLarge = false;
        string benchmarkProfile = "";
        bool ownershipOnly = false;
        bool showHelp = false;

        for (int index = 0; index < args.Length; index++)
        {
            string Next()
            {
                if (++index >= args.Length)
                {
                    throw new ArgumentException($"Missing value for {args[index - 1]}.");
                }
                return args[index];
            }

            switch (args[index])
            {
                case "--server-exe":
                    serverExecutable = Next();
                    break;
                case "--keep-artifacts":
                    keepArtifacts = true;
                    break;
                case "--skip-large-boundary-tests":
                    skipLarge = true;
                    break;
                case "--ownership-only":
                    ownershipOnly = true;
                    break;
                case "--benchmark-smoke-only":
                    benchmarkProfile = "smoke";
                    break;
                case "--benchmark-only":
                    benchmarkProfile = Next().ToLowerInvariant();
                    if (benchmarkProfile is not ("smoke" or "standard"))
                    {
                        throw new ArgumentException(
                            "--benchmark-only supports smoke or standard.");
                    }
                    break;
                case "--help":
                case "-h":
                    showHelp = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown argument: {args[index]}");
            }
        }
        if (ownershipOnly && !string.IsNullOrEmpty(benchmarkProfile))
        {
            throw new ArgumentException(
                "--ownership-only cannot be combined with benchmark-only options.");
        }
        return new(
            serverExecutable,
            keepArtifacts,
            skipLarge,
            benchmarkProfile,
            ownershipOnly,
            showHelp);
    }

    public static void PrintHelp()
    {
        Console.WriteLine(
            """
            LocalMediaTransfer isolated server test harness

            Usage:
              dotnet run --project tests/LocalMediaTransfer.TestHarness -- [options]

            Options:
              --server-exe <path>             Use a specific server executable.
              --keep-artifacts                Preserve the isolated temporary directory.
              --skip-large-boundary-tests     Skip 99/100/101 MiB boundary uploads.
              --ownership-only               Run only authenticated process-control checks.
              --benchmark-only <profile>      Run only smoke or standard benchmark profile.
              --benchmark-smoke-only          Alias for --benchmark-only smoke.
              --help                          Show this help.
            """);
    }
}

internal sealed class PipeConnection : IAsyncDisposable
{
    private readonly NamedPipeClientStream _pipe;
    private readonly CancellationTokenSource _cancellation = new();
    private readonly Task _drainTask;
    private readonly ConcurrentQueue<JsonElement> _metrics = new();
    private readonly ConcurrentDictionary<string,
        TaskCompletionSource<PipeCommandResult>> _pendingCommands = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public PipeConnection(NamedPipeClientStream pipe)
    {
        _pipe = pipe;
        VerifyLocalOnlyPipe();
        _drainTask = DrainAsync(_cancellation.Token);
    }

    private void VerifyLocalOnlyPipe()
    {
        if (!NativeMethods.GetNamedPipeInfo(
                _pipe.SafePipeHandle,
                out uint flags,
                nint.Zero,
                nint.Zero,
                nint.Zero))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not inspect the server named-pipe security flags.");
        }

        if ((flags & NativeMethods.PipeRejectRemoteClients) == 0)
        {
            throw new InvalidOperationException(
                "The server named pipe does not reject remote clients.");
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cancellation.Cancel();
        FailPendingCommands(new ObjectDisposedException(nameof(PipeConnection)));
        try
        {
            await _pipe.DisposeAsync();
            await _drainTask;
        }
        catch (Exception ex) when (
            ex is OperationCanceledException or IOException or ObjectDisposedException)
        {
        }
        finally
        {
            _writeLock.Dispose();
            _cancellation.Dispose();
        }
    }

    public async Task<JsonElement> WaitForMetricsAsync(
        Func<JsonElement, bool> predicate,
        TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            while (_metrics.TryDequeue(out JsonElement metrics))
            {
                if (predicate(metrics))
                {
                    return metrics;
                }
            }
            await Task.Delay(20);
        }
        throw new TimeoutException("Expected named-pipe metrics update was not received.");
    }

    public async Task SendAcknowledgedCommandAsync(
        string type,
        string data,
        TimeSpan? timeout = null)
    {
        string requestId = Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var completion = new TaskCompletionSource<PipeCommandResult>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pendingCommands.TryAdd(requestId, completion))
        {
            throw new InvalidOperationException(
                "Could not allocate a named-pipe command identifier.");
        }

        try
        {
            byte[] command = JsonSerializer.SerializeToUtf8Bytes(
                new { type, data, requestId });
            await _writeLock.WaitAsync(_cancellation.Token);
            try
            {
                await _pipe.WriteAsync(command, _cancellation.Token);
                await _pipe.FlushAsync(_cancellation.Token);
            }
            finally
            {
                _writeLock.Release();
            }

            PipeCommandResult result;
            try
            {
                result = await completion.Task.WaitAsync(
                    timeout ?? TimeSpan.FromSeconds(5));
            }
            catch (TimeoutException exception)
            {
                throw new TimeoutException(
                    $"The server did not acknowledge named-pipe command '{type}' in time.",
                    exception);
            }

            if (!result.Success)
            {
                throw new InvalidOperationException(
                    $"Named-pipe command '{type}' failed: {result.Error}");
            }
        }
        finally
        {
            _pendingCommands.TryRemove(requestId, out _);
        }
    }

    private async Task DrainAsync(CancellationToken cancellationToken)
    {
        byte[] buffer = new byte[4096];
        try
        {
            while (!cancellationToken.IsCancellationRequested && _pipe.IsConnected)
            {
                int read = await _pipe.ReadAsync(buffer, cancellationToken);
                if (read == 0)
                {
                    return;
                }

                int messageLength = read;
                while (!_pipe.IsMessageComplete)
                {
                    if (messageLength == buffer.Length)
                    {
                        Array.Resize(ref buffer, buffer.Length * 2);
                    }
                    read = await _pipe.ReadAsync(
                        buffer.AsMemory(messageLength),
                        cancellationToken);
                    if (read == 0)
                    {
                        return;
                    }
                    messageLength += read;
                }

                try
                {
                    using JsonDocument message = JsonDocument.Parse(
                        buffer.AsMemory(0, messageLength));
                    JsonElement root = message.RootElement;
                    string? messageType = root.GetProperty("type").GetString();
                    JsonElement messageData = root.GetProperty("data");
                    if (messageType == "metrics")
                    {
                        _metrics.Enqueue(messageData.Clone());
                    }
                    else if (messageType == "command_result")
                    {
                        string? requestId = messageData.GetProperty(
                            "requestId").GetString();
                        if (!string.IsNullOrEmpty(requestId) &&
                            _pendingCommands.TryRemove(requestId, out var completion))
                        {
                            bool success = messageData.GetProperty("success").GetBoolean();
                            string error = messageData.TryGetProperty("error", out var errorValue)
                                ? errorValue.GetString() ?? ""
                                : "";
                            completion.TrySetResult(new PipeCommandResult(success, error));
                        }
                    }
                }
                catch (JsonException)
                {
                    // The harness observes supported messages and keeps draining output.
                }
            }
        }
        finally
        {
            FailPendingCommands(new IOException(
                "The named-pipe connection closed before the server acknowledged the command."));
        }
    }

    private void FailPendingCommands(Exception exception)
    {
        foreach (var pending in _pendingCommands)
        {
            if (_pendingCommands.TryRemove(pending.Key, out var completion))
            {
                completion.TrySetException(exception);
            }
        }
    }

    private readonly record struct PipeCommandResult(bool Success, string Error);

    private static class NativeMethods
    {
        internal const uint PipeRejectRemoteClients = 0x00000008;

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetNamedPipeInfo(
            Microsoft.Win32.SafeHandles.SafePipeHandle pipe,
            out uint flags,
            nint outBufferSize,
            nint inBufferSize,
            nint maxInstances);
    }
}

internal sealed class OwnedProcess : IAsyncDisposable
{
    private readonly Process _process;
    private readonly Task<string> _standardOutput;
    private readonly Task<string> _standardError;
    private bool _disposed;

    private OwnedProcess(Process process, string label, bool echoOutput)
    {
        _process = process;
        _standardOutput = DrainAsync(process.StandardOutput, echoOutput ? Console.Out : null, label);
        _standardError = DrainAsync(process.StandardError, echoOutput ? Console.Error : null, label);
    }

    public bool HasExited => _process.HasExited;
    public int Id => _process.Id;
    public long StartTimeUtcFileTime =>
        _process.StartTime.ToUniversalTime().ToFileTimeUtc();
    public int ExitCode => _process.ExitCode;
    public string CapturedStandardOutput =>
        _standardOutput.IsCompletedSuccessfully ? _standardOutput.Result.Trim() : "";

    public static OwnedProcess Start(
        ProcessStartInfo startInfo,
        string label,
        bool echoOutput = false,
        string? standardInputLine = null)
    {
        Process process = Process.Start(startInfo) ??
                          throw new InvalidOperationException($"Failed to start {label}.");
        if (standardInputLine != null)
        {
            process.StandardInput.WriteLine(standardInputLine);
            process.StandardInput.Flush();
            process.StandardInput.Close();
        }
        return new(process, label, echoOutput);
    }

    public async Task<bool> WaitForExitAsync(TimeSpan timeout)
    {
        try
        {
            await _process.WaitForExitAsync().WaitAsync(timeout);
            await Task.WhenAll(_standardOutput, _standardError);
            return true;
        }
        catch (TimeoutException)
        {
            return false;
        }
    }

    public async Task StopAsync()
    {
        if (_disposed || _process.HasExited)
        {
            return;
        }

        try
        {
            _process.Kill(entireProcessTree: true);
            await WaitForExitAsync(TimeSpan.FromSeconds(5));
        }
        catch (InvalidOperationException)
        {
        }
    }

    public string FormatCapturedOutput()
    {
        if (!_process.HasExited)
        {
            return "";
        }

        string stdout = _standardOutput.IsCompletedSuccessfully ? _standardOutput.Result.Trim() : "";
        string stderr = _standardError.IsCompletedSuccessfully ? _standardError.Result.Trim() : "";
        var output = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(stdout))
        {
            output.AppendLine().Append("stdout: ").Append(stdout);
        }
        if (!string.IsNullOrWhiteSpace(stderr))
        {
            output.AppendLine().Append("stderr: ").Append(stderr);
        }
        return output.ToString();
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        if (!_process.HasExited)
        {
            try
            {
                _process.Kill(entireProcessTree: true);
                await _process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch
            {
            }
        }
        _process.Dispose();
    }

    private static async Task<string> DrainAsync(
        StreamReader reader,
        TextWriter? echo,
        string label)
    {
        var captured = new StringBuilder();
        while (await reader.ReadLineAsync() is { } line)
        {
            captured.AppendLine(line);
            if (echo is not null)
            {
                await echo.WriteLineAsync(line);
            }
        }
        return captured.ToString();
    }
}
