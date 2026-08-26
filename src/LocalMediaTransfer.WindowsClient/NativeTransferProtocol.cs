using System.Net.Http.Json;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

internal static class NativeTransferProtocol
{
    internal static void AddGrantHeaders(HttpRequestMessage request,
        TransferApproval approval, bool skip)
    {
        request.Headers.Add("X-Upload-Token", approval.Token);
        request.Headers.Add("X-Transfer-Id", approval.TransferId);
        request.Headers.Add("X-Skip-Duplicates", skip ? "true" : "false");
    }

    internal static async Task<JsonDocument> PostJsonAsync(HttpClient client,
        string path, object body, TransferApproval approval, bool skip,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
            { Content = JsonContent.Create(body) };
        AddGrantHeaders(request, approval, skip);
        using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
        return await PairingClient.ReadJsonAsync(response, cancellationToken);
    }
}
