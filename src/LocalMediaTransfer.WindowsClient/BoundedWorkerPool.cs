namespace LocalMediaTransfer.WindowsClient;

internal static class BoundedWorkerPool
{
    internal static async Task RunAsync<T>(IReadOnlyList<T> items, int maxWorkers,
        Func<int, T, CancellationToken, Task> process,
        Func<Exception, bool> sessionFatal, CancellationToken cancellationToken)
    {
        if (maxWorkers <= 0) throw new ArgumentOutOfRangeException(nameof(maxWorkers));
        using var sessionCancellation =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        int next = -1;
        var workers = Enumerable.Range(0, Math.Min(items.Count, maxWorkers))
            .Select(async _ =>
            {
                while (!sessionCancellation.IsCancellationRequested)
                {
                    int index = Interlocked.Increment(ref next);
                    if (index >= items.Count) return;
                    try
                    {
                        await process(index, items[index], sessionCancellation.Token);
                    }
                    catch (OperationCanceledException) when (
                        sessionCancellation.IsCancellationRequested &&
                        !cancellationToken.IsCancellationRequested)
                    {
                        return;
                    }
                    catch (Exception exception) when (sessionFatal(exception))
                    {
                        sessionCancellation.Cancel();
                        throw;
                    }
                }
            }).ToArray();
        await Task.WhenAll(workers);
        cancellationToken.ThrowIfCancellationRequested();
    }
}
