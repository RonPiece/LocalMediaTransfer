using System;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LocalMediaTransfer.GUI.Services
{
    internal sealed record ServerOwnershipContext(
        byte[] ControlKey,
        string ControlInstanceId,
        int OwnerProcessId,
        long OwnerProcessStartTimeUtcFileTime)
    {
        public string ControlTokenHex => Convert.ToHexString(ControlKey).ToLowerInvariant();

        public static ServerOwnershipContext CreatePersistent(
            ApplicationEnvironmentProfile profile)
        {
            byte[] key = ServerControlCredentialStore.LoadOrCreate(
                profile.TlsStorageDirectory,
                profile.Name);
            return Create(key);
        }

        public static ServerOwnershipContext CreateEphemeral() =>
            Create(RandomNumberGenerator.GetBytes(32));

        private static ServerOwnershipContext Create(byte[] key)
        {
            if (key.Length != 32)
            {
                throw new ArgumentException(
                    "The server ownership key must contain exactly 32 bytes.",
                    nameof(key));
            }
            using Process process = Process.GetCurrentProcess();
            return new ServerOwnershipContext(
                key,
                Guid.NewGuid().ToString("N"),
                process.Id,
                process.StartTime.ToUniversalTime().ToFileTimeUtc());
        }
    }

    internal sealed record ServerOwnershipProof(
        int ProtocolVersion,
        int ServerProcessId,
        long ServerProcessStartTimeUtcFileTime,
        int OwnerProcessId,
        long OwnerProcessStartTimeUtcFileTime,
        string Environment,
        string RuntimeInstanceId,
        string ControlInstanceId,
        string PipeName,
        string ClientNonce,
        string ServerNonce,
        string CredentialId,
        string Proof);

    internal sealed record PipeSessionExpectation(
        int ExpectedServerProcessId,
        long ExpectedServerProcessStartTimeUtcFileTime,
        int OwnerProcessId,
        long OwnerProcessStartTimeUtcFileTime,
        string Environment,
        string RuntimeInstanceId,
        string ControlInstanceId,
        string PipeName,
        byte[] ControlKey);

    internal static class ServerOwnershipProtocol
    {
        public const int ProtocolVersion = 1;

        public static string CreateProbe(string clientNonce) => JsonSerializer.Serialize(new
        {
            protocolVersion = ProtocolVersion,
            clientNonce
        });

        public static string CreateSessionRequest(
            PipeSessionExpectation expectation,
            string clientNonce)
        {
            byte[] authorization = HMACSHA256.HashData(
                expectation.ControlKey,
                Encoding.UTF8.GetBytes(BuildSessionRequestPayload(
                    expectation,
                    clientNonce)));
            return JsonSerializer.Serialize(new
            {
                protocolVersion = ProtocolVersion,
                clientNonce,
                ownerProcessId = expectation.OwnerProcessId,
                ownerProcessStartTimeUtcFileTime =
                    expectation.OwnerProcessStartTimeUtcFileTime.ToString(
                        CultureInfo.InvariantCulture),
                environment = expectation.Environment,
                runtimeInstanceId = expectation.RuntimeInstanceId,
                controlInstanceId = expectation.ControlInstanceId,
                pipeName = expectation.PipeName,
                authorization = Convert.ToHexString(authorization).ToLowerInvariant()
            });
        }

        public static bool VerifySessionProof(
            ServerOwnershipProof proof,
            PipeSessionExpectation expectation,
            string expectedClientNonce)
        {
            if (expectation.ControlKey.Length != 32 ||
                proof.ProtocolVersion != ProtocolVersion ||
                proof.ClientNonce != expectedClientNonce ||
                proof.OwnerProcessId != expectation.OwnerProcessId ||
                proof.OwnerProcessStartTimeUtcFileTime !=
                    expectation.OwnerProcessStartTimeUtcFileTime ||
                proof.Environment != expectation.Environment ||
                proof.RuntimeInstanceId != expectation.RuntimeInstanceId ||
                proof.ControlInstanceId != expectation.ControlInstanceId ||
                proof.PipeName != expectation.PipeName ||
                proof.ServerProcessId != expectation.ExpectedServerProcessId ||
                proof.ServerProcessStartTimeUtcFileTime !=
                    expectation.ExpectedServerProcessStartTimeUtcFileTime ||
                !IsLowerHex(proof.ClientNonce, 32) ||
                !IsLowerHex(proof.ServerNonce, 32) ||
                !IsLowerHex(proof.Proof, 64) ||
                !IsLowerHex(proof.CredentialId, 64))
            {
                return false;
            }

            string credentialId = Convert.ToHexString(
                SHA256.HashData(expectation.ControlKey)).ToLowerInvariant();
            if (!FixedTimeHexEquals(credentialId, proof.CredentialId)) return false;

            byte[] expected = HMACSHA256.HashData(
                expectation.ControlKey,
                Encoding.UTF8.GetBytes(BuildSessionProofPayload(proof)));
            return FixedTimeHexEquals(
                Convert.ToHexString(expected).ToLowerInvariant(),
                proof.Proof);
        }

        public static ServerOwnershipProof ParseProof(JsonElement data)
        {
            return new ServerOwnershipProof(
                data.GetProperty("protocolVersion").GetInt32(),
                data.GetProperty("serverProcessId").GetInt32(),
                ParseInt64(data, "serverProcessStartTimeUtcFileTime"),
                data.GetProperty("ownerProcessId").GetInt32(),
                ParseInt64(data, "ownerProcessStartTimeUtcFileTime"),
                data.GetProperty("environment").GetString() ?? "",
                data.GetProperty("runtimeInstanceId").GetString() ?? "",
                data.GetProperty("controlInstanceId").GetString() ?? "",
                data.GetProperty("pipeName").GetString() ?? "",
                data.GetProperty("clientNonce").GetString() ?? "",
                data.GetProperty("serverNonce").GetString() ?? "",
                data.GetProperty("credentialId").GetString() ?? "",
                data.GetProperty("proof").GetString() ?? "");
        }

        public static bool VerifyProof(
            ServerOwnershipProof proof,
            byte[] controlKey,
            string expectedClientNonce)
        {
            if (controlKey.Length != 32 ||
                proof.ProtocolVersion != ProtocolVersion ||
                proof.ClientNonce != expectedClientNonce ||
                !IsLowerHex(proof.ClientNonce, 32) ||
                !IsLowerHex(proof.ServerNonce, 32) ||
                !IsLowerHex(proof.Proof, 64) ||
                !IsLowerHex(proof.CredentialId, 64))
            {
                return false;
            }

            string credentialId = Convert.ToHexString(
                SHA256.HashData(controlKey)).ToLowerInvariant();
            if (!FixedTimeHexEquals(credentialId, proof.CredentialId)) return false;

            byte[] expected = HMACSHA256.HashData(
                controlKey,
                Encoding.UTF8.GetBytes(BuildProofPayload(proof)));
            return FixedTimeHexEquals(
                Convert.ToHexString(expected).ToLowerInvariant(),
                proof.Proof);
        }

        public static string CreateShutdownRequest(
            ServerOwnershipProof proof,
            byte[] controlKey)
        {
            byte[] authorization = HMACSHA256.HashData(
                controlKey,
                Encoding.UTF8.GetBytes(BuildShutdownPayload(proof)));
            return JsonSerializer.Serialize(new
            {
                protocolVersion = ProtocolVersion,
                clientNonce = proof.ClientNonce,
                serverNonce = proof.ServerNonce,
                authorization = Convert.ToHexString(authorization).ToLowerInvariant()
            });
        }

        private static string BuildProofPayload(ServerOwnershipProof proof) =>
            string.Join('\n',
                "lmt-ownership-proof-v1",
                proof.ClientNonce,
                proof.ServerNonce,
                proof.ServerProcessId.ToString(CultureInfo.InvariantCulture),
                proof.ServerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
                proof.OwnerProcessId.ToString(CultureInfo.InvariantCulture),
                proof.OwnerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
                proof.Environment,
                proof.RuntimeInstanceId,
                proof.ControlInstanceId,
                proof.PipeName,
                proof.CredentialId);

        private static string BuildShutdownPayload(ServerOwnershipProof proof) =>
            string.Join('\n',
                "lmt-shutdown-v1",
                proof.ClientNonce,
                proof.ServerNonce,
                proof.ServerProcessId.ToString(CultureInfo.InvariantCulture),
                proof.ServerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
                proof.Environment,
                proof.RuntimeInstanceId,
                proof.ControlInstanceId,
                proof.PipeName);

        private static string BuildSessionRequestPayload(
            PipeSessionExpectation expectation,
            string clientNonce) =>
            string.Join('\n',
                "lmt-pipe-session-request-v1",
                clientNonce,
                expectation.OwnerProcessId.ToString(CultureInfo.InvariantCulture),
                expectation.OwnerProcessStartTimeUtcFileTime.ToString(
                    CultureInfo.InvariantCulture),
                expectation.Environment,
                expectation.RuntimeInstanceId,
                expectation.ControlInstanceId,
                expectation.PipeName);

        private static string BuildSessionProofPayload(ServerOwnershipProof proof) =>
            string.Join('\n',
                "lmt-pipe-session-proof-v1",
                proof.ClientNonce,
                proof.ServerNonce,
                proof.ServerProcessId.ToString(CultureInfo.InvariantCulture),
                proof.ServerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
                proof.OwnerProcessId.ToString(CultureInfo.InvariantCulture),
                proof.OwnerProcessStartTimeUtcFileTime.ToString(CultureInfo.InvariantCulture),
                proof.Environment,
                proof.RuntimeInstanceId,
                proof.ControlInstanceId,
                proof.PipeName,
                proof.CredentialId);

        private static long ParseInt64(JsonElement data, string propertyName) =>
            long.Parse(
                data.GetProperty(propertyName).GetString() ?? "0",
                CultureInfo.InvariantCulture);

        private static bool IsLowerHex(string value, int length)
        {
            if (value.Length != length) return false;
            foreach (char character in value)
            {
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool FixedTimeHexEquals(string left, string right)
        {
            if (left.Length != right.Length) return false;
            return CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(left),
                Encoding.ASCII.GetBytes(right));
        }
    }
}
