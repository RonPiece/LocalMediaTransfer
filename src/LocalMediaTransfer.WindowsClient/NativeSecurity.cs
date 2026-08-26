using System.Buffers.Binary;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace LocalMediaTransfer.WindowsClient;

public static class NativeSecurity
{
    public static string GenerateHex(int byteCount) =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(byteCount)).ToLowerInvariant();

    public static string ComputeSecurityCode(
        string environment, string serverId, string fingerprint,
        string clientId, string clientNonce, string requestId)
    {
        using var stream = new MemoryStream();
        foreach (string value in new[]
        {
            "LMT-WINDOWS-PAIR-V1", environment, serverId, fingerprint,
            clientId, clientNonce, requestId
        })
        {
            AppendCanonical(stream, value);
        }
        byte[] digest = SHA256.HashData(stream.ToArray());
        uint prefix = BinaryPrimitives.ReadUInt32BigEndian(digest);
        string digits = (prefix % 100_000_000U).ToString("D8");
        return digits[..4] + " " + digits[4..];
    }

    public static string ComputeConfirmationProof(
        string credential, string requestId, string clientNonce)
    {
        using var stream = new MemoryStream();
        AppendCanonical(stream, "LMT-WINDOWS-PAIR-CONFIRM-V1");
        AppendCanonical(stream, requestId);
        AppendCanonical(stream, clientNonce);
        using var hmac = new HMACSHA256(Convert.FromHexString(credential));
        return Convert.ToHexString(hmac.ComputeHash(stream.ToArray())).ToLowerInvariant();
    }

    public static string CertificateFingerprint(X509Certificate2 certificate) =>
        Convert.ToHexString(SHA256.HashData(certificate.RawData)).ToLowerInvariant();

    public static HttpClient CreatePairingClient(Uri baseUri,
        Action<string> fingerprintObserved)
    {
        var handler = CreateHandler((certificate, errors) =>
        {
            if (certificate is null || !CertificateIsCurrentlyValid(certificate)) return false;
            fingerprintObserved(CertificateFingerprint(certificate));
            return errors is SslPolicyErrors.RemoteCertificateChainErrors or
                SslPolicyErrors.RemoteCertificateNameMismatch or
                (SslPolicyErrors.RemoteCertificateChainErrors |
                 SslPolicyErrors.RemoteCertificateNameMismatch) or
                SslPolicyErrors.None;
        });
        return new HttpClient(handler) { BaseAddress = baseUri, Timeout = TimeSpan.FromSeconds(15) };
    }

    public static HttpClient CreatePinnedClient(Uri baseUri, string expectedFingerprint)
    {
        string normalized = expectedFingerprint.Replace(":", "", StringComparison.Ordinal)
            .ToLowerInvariant();
        if (normalized.Length != 64) throw new ArgumentException("Invalid certificate fingerprint.");
        byte[] expected;
        try { expected = Convert.FromHexString(normalized); }
        catch (FormatException exception)
        {
            throw new ArgumentException("Invalid certificate fingerprint.",
                nameof(expectedFingerprint), exception);
        }
        var handler = CreateHandler((certificate, _) =>
        {
            if (certificate is null || !CertificateIsCurrentlyValid(certificate)) return false;
            byte[] actual = SHA256.HashData(certificate.RawData);
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        });
        return new HttpClient(handler) { BaseAddress = baseUri, Timeout = TimeSpan.FromSeconds(45) };
    }

    private static SocketsHttpHandler CreateHandler(
        Func<X509Certificate2?, SslPolicyErrors, bool> validator) => new()
    {
        ConnectTimeout = TimeSpan.FromSeconds(10),
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        SslOptions = new SslClientAuthenticationOptions
        {
            EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
            RemoteCertificateValidationCallback = (_, certificate, _, errors) =>
            {
                if (certificate is null) return validator(null, errors);
                using var copy = new X509Certificate2(certificate);
                return validator(copy, errors);
            }
        }
    };

    private static bool CertificateIsCurrentlyValid(X509Certificate2 certificate)
    {
        DateTime now = DateTime.UtcNow;
        return certificate.NotBefore.ToUniversalTime() <= now &&
            certificate.NotAfter.ToUniversalTime() >= now;
    }

    private static void AppendCanonical(Stream stream, string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(length, checked((uint)bytes.Length));
        stream.Write(length);
        stream.Write(bytes);
    }
}
