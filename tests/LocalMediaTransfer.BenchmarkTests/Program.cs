using LocalMediaTransfer.Benchmarks;

BenchmarkAcceptance.RequireSuccessfulTransfer(0, true);
foreach (var result in new[] { (Errors: 1, Integrity: true), (Errors: 0, Integrity: false), (Errors: 1, Integrity: false) })
{
    bool rejected = false;
    try { BenchmarkAcceptance.RequireSuccessfulTransfer(result.Errors, result.Integrity); }
    catch (InvalidOperationException) { rejected = true; }
    if (!rejected) throw new Exception("Failed benchmark accepted as a successful transfer.");
}
var stress = BenchmarkProfiles.Create(BenchmarkOptions.Parse(["--token", "synthetic", "--profile", "stress"]));
if (stress.Count != 11 || stress.Count(run => run.IsWarmup) != 1 ||
    stress.Any(run => run.FileConcurrency != 4 || run.Files.Count != 4) ||
    BenchmarkProfiles.ExpectedBytes(stress) != 4_659_871_744L)
    throw new Exception("Stress workload no longer matches its documented concurrency/disk budget.");
var soak = BenchmarkProfiles.Create(BenchmarkOptions.Parse(["--token", "synthetic", "--profile", "soak"]));
if (BenchmarkProfiles.ExpectedBytes(soak) != 15L * 1024 * 1024 * 1024)
    throw new Exception("Soak workload no longer matches its documented disk budget.");
Console.WriteLine("PASS benchmark acceptance: success, three failure combinations, stress and soak budgets (6 checks).");
