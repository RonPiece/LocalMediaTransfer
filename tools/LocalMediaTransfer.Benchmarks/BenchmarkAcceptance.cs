namespace LocalMediaTransfer.Benchmarks;

internal static class BenchmarkAcceptance
{
    public static void RequireSuccessfulTransfer(int errors, bool integrityOk)
    {
        if (errors != 0 || !integrityOk)
            throw new InvalidOperationException("Benchmark acceptance failed: transfer errors or SHA-256 mismatch; see exported results.");
    }
}
