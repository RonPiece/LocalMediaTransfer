using System.Net.Http.Json;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

internal sealed record ClientConfiguration(int ChunkSizeBytes, int ParallelFiles);
internal sealed record TransferApproval(string TransferId, string Token);

internal static class NativeTransferAuthorization
{
    private const int DefaultChunkBytes = 8 * 1024 * 1024;
    private const int DefaultParallelFiles = 6;

    internal static async Task<ClientConfiguration> GetConfigurationAsync(
        HttpClient client, CancellationToken cancellationToken)
    {
        using HttpResponseMessage response = await client.GetAsync("/config", cancellationToken);
        using JsonDocument json = await PairingClient.ReadJsonAsync(response, cancellationToken);
        try
        {
            JsonElement desktop = json.RootElement.GetProperty("desktop");
            return new ClientConfiguration(
                Math.Clamp(desktop.GetProperty("chunkSizeBytes").GetInt32(),
                    64 * 1024, DefaultChunkBytes),
                Math.Clamp(desktop.GetProperty("parallelFiles").GetInt32(),
                    1, DefaultParallelFiles));
        }
        catch (Exception exception) when (exception is KeyNotFoundException or
            InvalidOperationException or FormatException or OverflowException)
        {
            throw new NativeClientException("invalid_server_response",
                "The receiver returned an invalid desktop configuration.",
                false, exception);
        }
    }

    internal static async Task<TransferApproval> RequestApprovalAsync(HttpClient client,
        TrustedReceiver receiver, string sessionId, IReadOnlyList<TransferSource> sources,
        bool skip, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            "/native/v1/transfers/requests")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = 1,
                clientSessionId = sessionId,
                skipExactDuplicates = skip,
                files = sources.Select(file => new
                {
                    fileId = file.FileId,
                    name = file.Name,
                    sizeBytes = file.SizeBytes
                })
            })
        };
        request.Headers.Add("X-Device-Credential", receiver.Credential);
        using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
        using JsonDocument json = await PairingClient.ReadJsonAsync(response, cancellationToken);
        string requestId = PairingClient.RequiredString(json.RootElement, "requestId");
        string transferId = PairingClient.RequiredString(json.RootElement, "transferId");
        if (requestId.Length != 32 || transferId.Length != 32)
            throw new NativeClientException("invalid_server_response",
                "The receiver returned invalid transfer approval identifiers.");

        DateTimeOffset deadline = DateTimeOffset.UtcNow.AddMinutes(2);
        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(750, cancellationToken);
            using var statusRequest = new HttpRequestMessage(HttpMethod.Post,
                $"/native/v1/transfers/requests/{requestId}/status");
            statusRequest.Headers.Add("X-Device-Credential", receiver.Credential);
            using HttpResponseMessage statusResponse = await client.SendAsync(statusRequest,
                cancellationToken);
            using JsonDocument status = await PairingClient.ReadJsonAsync(statusResponse,
                cancellationToken);
            string state = PairingClient.RequiredString(status.RootElement, "status");
            if (state == "approved")
            {
                string token = PairingClient.RequiredString(status.RootElement, "token");
                if (token.Length != 64)
                    throw new NativeClientException("invalid_server_response",
                        "The receiver returned an invalid transfer grant.");
                return new TransferApproval(transferId, token);
            }
            if (state != "pending")
                throw new NativeClientException("invalid_server_response",
                    "The receiver returned an invalid transfer approval state.");
        }
        throw new NativeClientException("transfer_approval_expired",
            "The receiver did not approve the transfer before it expired.");
    }

    internal static async Task BestEffortCancelAsync(HttpClient client,
        TransferApproval approval, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"/native/v1/transfers/{approval.TransferId}/cancel");
            request.Headers.Add("X-Upload-Token", approval.Token);
            using HttpResponseMessage _ = await client.SendAsync(request, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or
            TaskCanceledException)
        {
            // Cleanup is best effort and must not replace the transfer result.
        }
    }
}
