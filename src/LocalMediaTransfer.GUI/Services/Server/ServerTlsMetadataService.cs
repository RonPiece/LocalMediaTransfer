using System;
using System.IO;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace LocalMediaTransfer.GUI.Services
{
    internal readonly record struct ServerTlsMetadata(string Fingerprint, string ExpiresAt);

    internal static class ServerTlsMetadataService
    {
        public static ServerTlsMetadata? TryRead(string tlsStorageDirectory)
        {
            string certificatePath = Path.Combine(tlsStorageDirectory, "server-cert.pem");
            if (!File.Exists(certificatePath))
            {
                return null;
            }

            using var certificate = X509Certificate2.CreateFromPemFile(certificatePath);
            return new ServerTlsMetadata(
                Convert.ToHexString(SHA256.HashData(certificate.RawData)).ToLowerInvariant(),
                certificate.NotAfter.ToString("u"));
        }
    }
}
