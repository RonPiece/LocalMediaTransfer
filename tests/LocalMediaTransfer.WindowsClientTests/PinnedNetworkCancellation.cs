using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using LocalMediaTransfer.WindowsClient;

internal static class PinnedNetworkCancellation
{
    public static async Task RunAsync(bool trickle)
    {
        using var rsa = RSA.Create(2048);
        var certificateRequest = new CertificateRequest("CN=localhost", rsa,
            HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var ephemeralCertificate = certificateRequest.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(10));
        // Schannel needs an imported key container for the server handshake.
        using var certificate = new X509Certificate2(ephemeralCertificate.Export(X509ContentType.Pfx));
        using var serverStop = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var headersSent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var endpoint = (IPEndPoint)listener.LocalEndpoint;
        Task server = ServeAsync();
        try
        {
            using var client = NativeSecurity.CreatePinnedClient(new Uri($"https://127.0.0.1:{endpoint.Port}"),
                NativeSecurity.CertificateFingerprint(certificate));
            using var cancel = new CancellationTokenSource();
            Task<HttpResponseMessage> response = client.GetAsync("/synthetic", cancel.Token);
            await headersSent.Task.WaitAsync(TimeSpan.FromSeconds(10));
            cancel.CancelAfter(TimeSpan.FromMilliseconds(300));
            try
            {
                using var unexpected = await response.WaitAsync(TimeSpan.FromSeconds(3));
                throw new InvalidOperationException("Incomplete pinned response was reported as complete.");
            }
            catch (OperationCanceledException) when (cancel.IsCancellationRequested) { }
        }
        finally
        {
            serverStop.Cancel();
            listener.Stop();
            await server.WaitAsync(TimeSpan.FromSeconds(3));
        }

        async Task ServeAsync()
        {
            try
            {
                using var socket = await listener.AcceptTcpClientAsync(serverStop.Token);
                using var tls = new SslStream(socket.GetStream());
                await tls.AuthenticateAsServerAsync(new SslServerAuthenticationOptions {
                    ServerCertificate = certificate, EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13
                }, serverStop.Token);
                byte[] buffer = new byte[8192];
                int received = 0;
                while (!Encoding.ASCII.GetString(buffer, 0, received).Contains("\r\n\r\n", StringComparison.Ordinal))
                {
                    if (received == buffer.Length) throw new IOException("Synthetic request exceeded header bound.");
                    int read = await tls.ReadAsync(buffer.AsMemory(received), serverStop.Token);
                    if (read == 0) throw new IOException("Client closed before sending its request.");
                    received += read;
                }
                await tls.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n"), serverStop.Token);
                await tls.FlushAsync(serverStop.Token);
                headersSent.TrySetResult();
                while (!serverStop.IsCancellationRequested)
                {
                    if (trickle)
                    {
                        await tls.WriteAsync(new byte[] { 32 }, serverStop.Token);
                        await tls.FlushAsync(serverStop.Token);
                    }
                    await Task.Delay(50, serverStop.Token);
                }
            }
            catch (Exception exception) when (serverStop.IsCancellationRequested &&
                exception is OperationCanceledException or IOException or SocketException or ObjectDisposedException) { }
            catch (IOException) when (headersSent.Task.IsCompletedSuccessfully) { }
            catch (Exception exception)
            {
                headersSent.TrySetException(exception);
                throw;
            }
        }
    }
}
