using System.Net.Http.Json;

namespace LocalMediaTransfer.WindowsClient;

/// <summary>Best-effort, coalesced reporting for an approved outbound transfer.</summary>
internal sealed class NativeTransferTelemetry(HttpClient client, string credential, string sessionId)
{
    private readonly object _gate = new();
    private Task? _pump;
    private double? _pendingBytesPerSecond;
    private DateTimeOffset _lastSentAt = DateTimeOffset.MinValue;
    private bool _finished;

    public Task StartAsync() => SendLogAsync("transfer_started");

    public void RecordCurrentMediaRate(double currentMBps)
    {
        lock (_gate)
        {
            if (_finished) return;
            _pendingBytesPerSecond = Math.Max(0, currentMBps) * 1_000_000d;
            _pump ??= Task.Run(PumpAsync);
        }
    }

    public async Task FinishAsync(string outcome)
    {
        Task? pump;
        lock (_gate)
        {
            _finished = true;
            _pendingBytesPerSecond = null;
            pump = _pump;
        }
        if (pump != null)
        {
            try { await pump; }
            catch (Exception) { /* A telemetry worker cannot fail the transfer. */ }
        }
        await SendMetricAsync(0);
        await SendLogAsync(outcome);
    }

    private async Task PumpAsync()
    {
        while (true)
        {
            TimeSpan delay;
            lock (_gate)
            {
                if (_finished || !_pendingBytesPerSecond.HasValue)
                {
                    _pump = null;
                    return;
                }
                delay = TimeSpan.FromSeconds(1) - (DateTimeOffset.UtcNow - _lastSentAt);
            }
            if (delay > TimeSpan.Zero) await Task.Delay(delay);
            double? sample;
            lock (_gate)
            {
                if (_finished)
                {
                    _pump = null;
                    return;
                }
                sample = _pendingBytesPerSecond;
                _pendingBytesPerSecond = null;
                _lastSentAt = DateTimeOffset.UtcNow;
            }
            if (sample.HasValue) await SendMetricAsync(sample.Value);
        }
    }

    private async Task SendMetricAsync(double bytesPerSecond) =>
        await PostAsync("/client_metrics", new { sessionId, bytesPerSecond });

    private async Task SendLogAsync(string eventName) =>
        await PostAsync("/client_log", new
        {
            session = sessionId, level = "INFO", @event = eventName,
            message = "Windows transfer lifecycle"
        });

    private async Task PostAsync(string path, object body)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path)
            {
                Content = JsonContent.Create(body)
            };
            request.Headers.Add("X-Upload-Token", credential);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            using HttpResponseMessage _ = await client.SendAsync(request, timeout.Token);
        }
        catch (Exception)
        {
            // Telemetry must never change the result of the transfer.
        }
    }
}
