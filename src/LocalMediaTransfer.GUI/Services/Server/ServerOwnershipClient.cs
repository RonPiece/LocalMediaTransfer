using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    internal enum ServerOwnershipStatus
    {
        VerifiedStaleOwner,
        ActiveOwner,
        Unverified
    }

    internal sealed record ServerOwnershipInspection(
        ServerOwnershipStatus Status,
        ServerOwnershipProof? Proof,
        string Explanation);

    internal sealed record ServerOwnershipExpectation(
        string Environment,
        string RuntimeInstanceId,
        string PipeName,
        string ExecutablePath,
        string OwnerExecutablePath,
        byte[] ControlKey);

    internal interface IServerOwnershipClient
    {
        Task<ServerOwnershipInspection> InspectAsync(
            ServerOwnershipExpectation expectation,
            CancellationToken cancellationToken = default);

        Task<bool> RequestShutdownAsync(
            ServerOwnershipExpectation expectation,
            ServerOwnershipInspection previousInspection,
            CancellationToken cancellationToken = default);
    }

    internal sealed class ServerOwnershipClient : IServerOwnershipClient
    {
        private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(3);
        private static readonly TimeSpan ExitTimeout = TimeSpan.FromSeconds(5);

        public async Task<ServerOwnershipInspection> InspectAsync(
            ServerOwnershipExpectation expectation,
            CancellationToken cancellationToken = default)
        {
            try
            {
                ServerOwnershipProof proof = await RequestProofAsync(
                    expectation,
                    cancellationToken);
                string? mismatch = ValidateIdentity(proof, expectation);
                if (mismatch != null)
                {
                    return new(ServerOwnershipStatus.Unverified, null, mismatch);
                }

                ExactProcessStatus ownerStatus = InspectExactProcess(
                    proof.OwnerProcessId,
                    proof.OwnerProcessStartTimeUtcFileTime,
                    expectation.OwnerExecutablePath);
                if (ownerStatus == ExactProcessStatus.Matching)
                {
                    return new(
                        ServerOwnershipStatus.ActiveOwner,
                        proof,
                        $"The verified server is owned by active GUI process {proof.OwnerProcessId}.");
                }
                if (ownerStatus == ExactProcessStatus.MismatchOrInaccessible)
                {
                    return new(
                        ServerOwnershipStatus.Unverified,
                        null,
                        "The recorded GUI owner could not be verified safely.");
                }

                return new(
                    ServerOwnershipStatus.VerifiedStaleOwner,
                    proof,
                    $"Verified stale server process {proof.ServerProcessId}; its recorded GUI owner is no longer running.");
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error) when (
                error is IOException or TimeoutException or OperationCanceledException or
                UnauthorizedAccessException or CryptographicException or JsonException or
                InvalidOperationException or ArgumentException)
            {
                return new(
                    ServerOwnershipStatus.Unverified,
                    null,
                    "The existing server did not provide a complete authenticated ownership proof.");
            }
        }

        public async Task<bool> RequestShutdownAsync(
            ServerOwnershipExpectation expectation,
            ServerOwnershipInspection previousInspection,
            CancellationToken cancellationToken = default)
        {
            if (previousInspection.Status != ServerOwnershipStatus.VerifiedStaleOwner ||
                previousInspection.Proof == null)
            {
                return false;
            }

            using var pipe = await ConnectAsync(expectation.PipeName, cancellationToken);
            ServerOwnershipProof freshProof = await RequestProofAsync(
                expectation,
                pipe,
                cancellationToken);
            string? mismatch = ValidateIdentity(freshProof, expectation);
            if (mismatch != null ||
                freshProof.ServerProcessId != previousInspection.Proof.ServerProcessId ||
                freshProof.ServerProcessStartTimeUtcFileTime !=
                    previousInspection.Proof.ServerProcessStartTimeUtcFileTime ||
                freshProof.ControlInstanceId != previousInspection.Proof.ControlInstanceId ||
                InspectExactProcess(
                    freshProof.OwnerProcessId,
                    freshProof.OwnerProcessStartTimeUtcFileTime,
                    expectation.OwnerExecutablePath) != ExactProcessStatus.NotRunning)
            {
                return false;
            }

            string request = ServerOwnershipProtocol.CreateShutdownRequest(
                freshProof,
                expectation.ControlKey);
            using var writeLock = new SemaphoreSlim(1, 1);
            PipeSendResult result = await PipeCommandSender.SendAsync(
                pipe,
                writeLock,
                "ownership_shutdown",
                request);
            if (!result.Success) return false;

            DateTime deadline = DateTime.UtcNow + ExitTimeout;
            while (DateTime.UtcNow < deadline)
            {
                if (InspectExactProcess(
                        freshProof.ServerProcessId,
                        freshProof.ServerProcessStartTimeUtcFileTime,
                        expectation.ExecutablePath) == ExactProcessStatus.NotRunning)
                {
                    return true;
                }
                await Task.Delay(100, cancellationToken);
            }
            return false;
        }

        private static async Task<ServerOwnershipProof> RequestProofAsync(
            ServerOwnershipExpectation expectation,
            CancellationToken cancellationToken)
        {
            using var pipe = await ConnectAsync(expectation.PipeName, cancellationToken);
            return await RequestProofAsync(expectation, pipe, cancellationToken);
        }

        private static async Task<ServerOwnershipProof> RequestProofAsync(
            ServerOwnershipExpectation expectation,
            NamedPipeClientStream pipe,
            CancellationToken cancellationToken)
        {
            string nonce = Convert.ToHexString(
                RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            using var writeLock = new SemaphoreSlim(1, 1);
            PipeSendResult send = await PipeCommandSender.SendAsync(
                pipe,
                writeLock,
                "ownership_probe",
                ServerOwnershipProtocol.CreateProbe(nonce));
            if (!send.Success)
            {
                throw new IOException("Could not send the ownership probe.");
            }

            byte[] buffer = new byte[PipeMessageReader.ReadBufferSize];
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken);
            timeout.CancelAfter(ConnectTimeout);
            while (true)
            {
                PipeReadResult read = await PipeMessageReader.ReadMessageAsync(
                    pipe,
                    buffer,
                    timeout.Token);
                if (read.Status != PipeReadStatus.Message)
                {
                    throw new IOException("The ownership proof channel disconnected.");
                }

                using JsonDocument document = JsonDocument.Parse(read.Message!);
                JsonElement root = document.RootElement;
                if (root.GetProperty("type").GetString() != "ownership_proof")
                {
                    continue;
                }

                ServerOwnershipProof proof = ServerOwnershipProtocol.ParseProof(
                    root.GetProperty("data"));
                if (!ServerOwnershipProtocol.VerifyProof(
                        proof,
                        expectation.ControlKey,
                        nonce))
                {
                    throw new CryptographicException(
                        "The server ownership proof signature is invalid.");
                }
                return proof;
            }
        }

        private static async Task<NamedPipeClientStream> ConnectAsync(
            string pipeName,
            CancellationToken cancellationToken)
        {
            var pipe = new NamedPipeClientStream(
                ".",
                pipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                    cancellationToken);
                timeout.CancelAfter(ConnectTimeout);
                await pipe.ConnectAsync(timeout.Token);
                pipe.ReadMode = PipeTransmissionMode.Message;
                return pipe;
            }
            catch
            {
                pipe.Dispose();
                throw;
            }
        }

        private static string? ValidateIdentity(
            ServerOwnershipProof proof,
            ServerOwnershipExpectation expectation)
        {
            if (proof.Environment != expectation.Environment)
                return "The server environment does not match this GUI.";
            if (proof.RuntimeInstanceId != expectation.RuntimeInstanceId)
                return "The server runtime instance does not match this GUI.";
            if (proof.PipeName != expectation.PipeName)
                return "The server control endpoint does not match this GUI.";
            if (proof.ServerProcessId <= 0 ||
                proof.ServerProcessStartTimeUtcFileTime <= 0 ||
                string.IsNullOrWhiteSpace(proof.ControlInstanceId))
                return "The server process identity is incomplete.";
            if (InspectExactProcess(
                    proof.ServerProcessId,
                    proof.ServerProcessStartTimeUtcFileTime,
                    expectation.ExecutablePath) != ExactProcessStatus.Matching)
                return "The proved server PID, creation time, or executable does not match Windows.";
            return null;
        }

        private enum ExactProcessStatus
        {
            Matching,
            NotRunning,
            MismatchOrInaccessible
        }

        private static ExactProcessStatus InspectExactProcess(
            int processId,
            long creationTimeUtcFileTime,
            string? expectedExecutablePath)
        {
            try
            {
                using Process process = Process.GetProcessById(processId);
                if (process.HasExited ||
                    process.StartTime.ToUniversalTime().ToFileTimeUtc() !=
                        creationTimeUtcFileTime)
                {
                    return ExactProcessStatus.NotRunning;
                }
                if (expectedExecutablePath == null) return ExactProcessStatus.Matching;

                string actualPath = process.MainModule?.FileName ?? "";
                return string.Equals(
                    Path.GetFullPath(actualPath),
                    Path.GetFullPath(expectedExecutablePath),
                    StringComparison.OrdinalIgnoreCase)
                    ? ExactProcessStatus.Matching
                    : ExactProcessStatus.MismatchOrInaccessible;
            }
            catch (ArgumentException)
            {
                return ExactProcessStatus.NotRunning;
            }
            catch (Exception error) when (
                error is InvalidOperationException or
                System.ComponentModel.Win32Exception or NotSupportedException)
            {
                return ExactProcessStatus.MismatchOrInaccessible;
            }
        }
    }
}
