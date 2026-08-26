using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Diagnostics;

namespace LocalMediaTransfer.GUI.Services
{
    /// <summary>
    /// Small LocalAppData-backed settings store for unpackaged WinUI runs.
    /// </summary>
    public static class AppSettingsStore
    {
        private static readonly object SyncRoot = new();
        private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
        private static readonly string SettingsPath = ApplicationEnvironment.Current.SettingsPath;

        public static void SetString(string key, string value)
        {
            lock (SyncRoot)
            {
                var settings = Load();
                settings.Strings[key] = value;
                Save(settings);
            }
        }

        public static string? GetString(string key)
        {
            lock (SyncRoot)
            {
                var settings = Load();
                return settings.Strings.TryGetValue(key, out var value) ? value : null;
            }
        }

        public static void SetInt(string key, int value)
        {
            lock (SyncRoot)
            {
                var settings = Load();
                settings.Ints[key] = value;
                Save(settings);
            }
        }

        public static int? GetInt(string key)
        {
            lock (SyncRoot)
            {
                var settings = Load();
                return settings.Ints.TryGetValue(key, out var value) ? value : null;
            }
        }

        private static SettingsModel Load()
        {
            try
            {
                if (!File.Exists(SettingsPath))
                {
                    return new SettingsModel();
                }

                var json = File.ReadAllText(SettingsPath);
                return JsonSerializer.Deserialize<SettingsModel>(json) ?? new SettingsModel();
            }
            catch (Exception error)
            {
                Debug.WriteLine(
                    $"GUI settings could not be loaded; safe defaults will be used: {error.GetType().Name}");
                return new SettingsModel();
            }
        }

        private static void Save(SettingsModel settings)
        {
            var directory = Path.GetDirectoryName(SettingsPath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var tempPath = SettingsPath + ".tmp";
            File.WriteAllText(tempPath, JsonSerializer.Serialize(settings, JsonOptions));
            File.Move(tempPath, SettingsPath, overwrite: true);
        }

        private sealed class SettingsModel
        {
            public Dictionary<string, string> Strings { get; set; } = new();
            public Dictionary<string, int> Ints { get; set; } = new();
        }
    }
}
