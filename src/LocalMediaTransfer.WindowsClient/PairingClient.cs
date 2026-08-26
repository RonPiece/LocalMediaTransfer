using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

public sealed class PairingClient
{
    public async Task<DiscoveredReceiver> ProbeManualAsync(string address,
        int httpsPort, string environment, CancellationToken cancellationToken)
    {
        var provisional = new DiscoveredReceiver("", address, environment,
            address, httpsPort, "", new NativeCapability(1, false));
        string fingerprint = "";
        using HttpClient client = NativeSecurity.CreatePairingClient(
            provisional.HttpsBaseUri, value => fingerprint = value);
        using HttpResponseMessage response = await client.GetAsync(
            "/native/v1/identity", cancellationToken);
        using JsonDocument json = await ReadJsonAsync(response, cancellationToken);
        JsonElement root = json.RootElement;
        if (RequiredString(root, "environment") != environment)
            throw new NativeClientException("environment_mismatch",
                "The receiver belongs to a different application environment.");
        return provisional with
        {
            ServerId = RequiredString(root, "serverId"),
            AdvertisedCertificateFingerprint = fingerprint,
            NativeWindows = new NativeCapability(1,
                root.TryGetProperty("pairingAvailable", out JsonElement available) &&
                available.GetBoolean())
        };
    }

    public async Task<PairingSession> StartAsync(DiscoveredReceiver receiver,
        string clientId, string clientName, CancellationToken cancellationToken)
    {
        if (!receiver.SupportsNativeWindows)
            throw new NativeClientException("native_transfer_unavailable",
                "This receiver supports Browser transfer only.");
        string credential = NativeSecurity.GenerateHex(32);
        string nonce = NativeSecurity.GenerateHex(32);
        string observedFingerprint = "";
        using HttpClient client = NativeSecurity.CreatePairingClient(
            receiver.HttpsBaseUri, value => observedFingerprint = value);
        using HttpResponseMessage response = await client.PostAsJsonAsync(
            "/native/v1/pairing/requests", new
            {
                protocolVersion = 1,
                environment = receiver.Environment,
                serverId = receiver.ServerId,
                clientId,
                clientName,
                clientNonce = nonce,
                credential
            }, cancellationToken);
        using JsonDocument json = await ReadJsonAsync(response, cancellationToken);
        string requestId = RequiredString(json.RootElement, "requestId");
        if (observedFingerprint.Length != 64 || requestId.Length != 32)
            throw new NativeClientException("pairing_identity_invalid",
                "The receiver pairing identity is invalid.");
        string code = NativeSecurity.ComputeSecurityCode(receiver.Environment,
            receiver.ServerId, observedFingerprint, clientId, nonce, requestId);
        return new PairingSession(receiver, clientId, credential, nonce,
            requestId, observedFingerprint, code);
    }

    public async Task ConfirmAsync(PairingSession session,
        CancellationToken cancellationToken)
    {
        using HttpClient client = NativeSecurity.CreatePinnedClient(
            session.Receiver.HttpsBaseUri, session.ObservedFingerprint);
        string proof = NativeSecurity.ComputeConfirmationProof(session.Credential,
            session.RequestId, session.ClientNonce);
        using HttpResponseMessage response = await client.PostAsJsonAsync(
            $"/native/v1/pairing/requests/{session.RequestId}/confirm",
            new { proof }, cancellationToken);
        using JsonDocument _ = await ReadJsonAsync(response, cancellationToken);
    }

    public async Task<TrustedReceiver> WaitForApprovalAsync(PairingSession session,
        CancellationToken cancellationToken)
    {
        using HttpClient client = NativeSecurity.CreatePinnedClient(
            session.Receiver.HttpsBaseUri, session.ObservedFingerprint);
        DateTimeOffset deadline = DateTimeOffset.UtcNow.AddMinutes(2);
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using HttpResponseMessage response = await client.PostAsJsonAsync(
                $"/native/v1/pairing/requests/{session.RequestId}/status",
                new { clientId = session.ClientId, credential = session.Credential },
                cancellationToken);
            using JsonDocument json = await ReadJsonAsync(response, cancellationToken,
                allowForbidden: true);
            string status = RequiredString(json.RootElement, "status");
            if (status == "approved")
                return new TrustedReceiver(session.Receiver.ServerId,
                    session.Receiver.Name, session.Receiver.Environment,
                    session.Receiver.Address, session.Receiver.HttpsPort,
                    session.ObservedFingerprint, session.Credential,
                    DateTimeOffset.UtcNow);
            if (status == "denied")
                throw new NativeClientException("pairing_denied",
                    "The receiver declined the pairing request.");
            await Task.Delay(750, cancellationToken);
        }
        throw new NativeClientException("pairing_expired",
            "The pairing request expired. Open pairing on the receiver and try again.");
    }

    public async Task RejectAsync(PairingSession session,
        CancellationToken cancellationToken)
    {
        using HttpClient client = NativeSecurity.CreatePinnedClient(
            session.Receiver.HttpsBaseUri, session.ObservedFingerprint);
        using HttpRequestMessage request = new(HttpMethod.Delete,
            $"/native/v1/pairing/requests/{session.RequestId}");
        using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
        if (response.StatusCode != HttpStatusCode.NotFound)
            using (await ReadJsonAsync(response, cancellationToken)) { }
    }

    internal static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response,
        CancellationToken cancellationToken, bool allowForbidden = false)
    {
        JsonDocument json;
        try { json = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken); }
        catch (JsonException exception)
        {
            throw new NativeClientException("invalid_server_response",
                "The receiver returned an invalid response.", false, exception);
        }
        if (response.IsSuccessStatusCode ||
            (allowForbidden && response.StatusCode == HttpStatusCode.Forbidden)) return json;
        string code = json.RootElement.TryGetProperty("error", out JsonElement error) &&
            error.ValueKind == JsonValueKind.String
            ? error.GetString() ?? "receiver_error" : "receiver_error";
        string message = json.RootElement.TryGetProperty("message", out JsonElement text) &&
            text.ValueKind == JsonValueKind.String
            ? text.GetString() ?? "The receiver rejected the request."
            : "The receiver rejected the request.";
        bool retryable = json.RootElement.TryGetProperty("retryable", out JsonElement retry) &&
            retry.ValueKind == JsonValueKind.True;
        json.Dispose();
        TimeSpan? retryAfter = response.Headers.RetryAfter?.Delta;
        throw new NativeClientException(code, message, retryable,
            statusCode: response.StatusCode, retryAfter: retryAfter);
    }

    internal static string RequiredString(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out JsonElement value) ||
            value.ValueKind != JsonValueKind.String ||
            string.IsNullOrEmpty(value.GetString()))
            throw new NativeClientException("invalid_server_response",
                "The receiver returned an invalid response.");
        return value.GetString()!;
    }
}
