using System.Globalization;
using System.Text;
using System.Text.Json;

namespace LocalMediaTransfer.Benchmarks;

internal static class BenchmarkExporter
{
    public static async Task<(string JsonPath, string CsvPath)> ExportAsync(
        string directory,
        string runId,
        string label,
        string json,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(directory);
        string safeLabel = string.Concat(label.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        string prefix = $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{safeLabel}-{runId[..Math.Min(8, runId.Length)]}";
        string jsonPath = Path.Combine(directory, prefix + ".json");
        string csvPath = Path.Combine(directory, prefix + ".csv");

        await File.WriteAllTextAsync(jsonPath, json, Encoding.UTF8, cancellationToken);
        await File.WriteAllTextAsync(
            csvPath,
            CreateCsv(json),
            Encoding.UTF8,
            cancellationToken);
        return (jsonPath, csvPath);
    }

    private static string CreateCsv(string json)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        JsonElement root = document.RootElement;
        var output = new StringBuilder();
        output.AppendLine(
            "record_type,run_id,profile,status,total_bytes,duration_ms,average_MBps," +
            "file_id,source_name,size_bytes,file_duration_ms,file_MBps,integrity_ok,error," +
            "sample_elapsed_ms,sample_MBps,cpu_percent,working_set_bytes,transferred_bytes");

        WriteRow(output,
            "run",
            Text(root, "id"),
            Text(root, "profile"),
            Text(root, "status"),
            Number(root, "totalBytes"),
            Number(root, "durationMs"),
            Number(root, "averageMBps"));

        if (root.TryGetProperty("files", out JsonElement files))
        {
            foreach (JsonElement file in files.EnumerateArray())
            {
                WriteRow(output,
                    "file",
                    Text(root, "id"),
                    Text(root, "profile"),
                    Text(root, "status"),
                    "", "", "",
                    Text(file, "fileId"),
                    Text(file, "sourceName"),
                    Number(file, "sizeBytes"),
                    Number(file, "durationMs"),
                    Number(file, "throughputMBps"),
                    Boolean(file, "integrityOk"),
                    Text(file, "error"));
            }
        }

        if (root.TryGetProperty("samples", out JsonElement samples))
        {
            foreach (JsonElement sample in samples.EnumerateArray())
            {
                WriteRow(output,
                    "sample",
                    Text(root, "id"),
                    Text(root, "profile"),
                    Text(root, "status"),
                    "", "", "", "", "", "", "", "", "", "",
                    Number(sample, "elapsedMs"),
                    Number(sample, "throughputMBps"),
                    Number(sample, "cpuPercent"),
                    Number(sample, "workingSetBytes"),
                    Number(sample, "transferredBytes"));
            }
        }

        return output.ToString();
    }

    private static string Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) ? value.ToString() : "";

    private static string Number(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.Number
            ? value.GetRawText()
            : "";

    private static string Boolean(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) &&
        value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean().ToString(CultureInfo.InvariantCulture)
            : "";

    private static void WriteRow(StringBuilder output, params object?[] values)
    {
        output.AppendLine(string.Join(",", values.Select(value => Escape(value?.ToString() ?? ""))));
    }

    private static string Escape(string value)
    {
        if (value.IndexOfAny([',', '"', '\r', '\n']) < 0) return value;
        return '"' + value.Replace("\"", "\"\"") + '"';
    }
}
