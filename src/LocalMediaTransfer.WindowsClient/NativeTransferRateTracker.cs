using System.Diagnostics;

namespace LocalMediaTransfer.WindowsClient;

/// <summary>Rolling acknowledged media rate with a slow-chunk freshness lease.</summary>
internal sealed class NativeTransferRateTracker(long startedTicks)
{
    private readonly Queue<(long Bytes, long Ticks)> _samples = new();
    private long _activeBytes;
    private long _lastAcknowledgementTicks;
    private double _lastRateMBps;

    public long AcknowledgedBytes { get; private set; }
    public double PeakMBps { get; private set; }

    public void Acknowledge(long bytes, long ticks)
    {
        if (bytes <= 0) return;
        AcknowledgedBytes += bytes;
        _activeBytes += bytes;
        _samples.Enqueue((bytes, ticks));
        while (_samples.Count > 0 &&
            Stopwatch.GetElapsedTime(_samples.Peek().Ticks, ticks) >= TimeSpan.FromSeconds(5))
        {
            _activeBytes -= _samples.Dequeue().Bytes;
        }
        double seconds = Math.Max(0.001,
            Math.Min(5, Stopwatch.GetElapsedTime(startedTicks, ticks).TotalSeconds));
        _lastRateMBps = _activeBytes / seconds / 1_000_000d;
        _lastAcknowledgementTicks = ticks;
        PeakMBps = Math.Max(PeakMBps, _lastRateMBps);
    }

    public double CurrentMBps(long ticks)
    {
        if (_lastAcknowledgementTicks == 0 || _lastRateMBps <= 0) return 0;
        double staleAfterMs = Math.Clamp(
            2d * 8 * 1024 * 1024 / (_lastRateMBps * 1_000_000d) * 1000d,
            5000d, 30000d);
        return Stopwatch.GetElapsedTime(_lastAcknowledgementTicks, ticks).TotalMilliseconds <= staleAfterMs
            ? _lastRateMBps : 0;
    }
}
