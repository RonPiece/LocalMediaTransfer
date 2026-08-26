using System;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    internal sealed class PipeSessionAuthenticator
    {
        private static readonly TimeSpan AuthenticationTimeout = TimeSpan.FromSeconds(3);
        private readonly Func<PipeSessionExpectation> _expectationProvider;

        public PipeSessionAuthenticator(
            Func<PipeSessionExpectation> expectationProvider)
        {
            _expectationProvider = expectationProvider ??
                throw new ArgumentNullException(nameof(expectationProvider));
        }

        public async Task AuthenticateAsync(
            NamedPipeClientStream pipe,
            byte[] buffer,
            CancellationToken cancellationToken)
        {
            PipeSessionExpectation expectation = _expectationProvider();
            string clientNonce = Convert.ToHexString(
                RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            string request = ServerOwnershipProtocol.CreateSessionRequest(
                expectation,
                clientNonce);
            using var writeLock = new SemaphoreSlim(1, 1);
            PipeSendResult sent = await PipeCommandSender.SendAsync(
                pipe,
                writeLock,
                "session_auth",
                request);
            if (!sent.Success)
            {
                throw new IOException("Could not send the pipe authentication request.");
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken);
            timeout.CancelAfter(AuthenticationTimeout);
            while (true)
            {
                PipeReadResult read = await PipeMessageReader.ReadMessageAsync(
                    pipe,
                    buffer,
                    timeout.Token);
                if (read.Status != PipeReadStatus.Message)
                {
                    throw new IOException("The pipe authentication channel disconnected.");
                }

                using JsonDocument document = JsonDocument.Parse(read.Message!);
                JsonElement root = document.RootElement;
                string type = root.GetProperty("type").GetString() ?? "";
                if (type == "session_rejected")
                {
                    throw new CryptographicException(
                        "The server rejected pipe session authentication.");
                }
                if (type != "session_ready")
                {
                    continue;
                }

                ServerOwnershipProof proof = ServerOwnershipProtocol.ParseProof(
                    root.GetProperty("data"));
                if (!ServerOwnershipProtocol.VerifySessionProof(
                        proof,
                        expectation,
                        clientNonce))
                {
                    throw new CryptographicException(
                        "The pipe endpoint did not prove the expected server identity.");
                }
                return;
            }
        }
    }
}
