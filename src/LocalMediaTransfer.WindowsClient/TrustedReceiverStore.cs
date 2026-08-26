using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

public sealed class TrustedReceiverStore
{
    private const uint CryptProtectUiForbidden = 0x1;
    private readonly string _path;
    private readonly string _environment;
    private readonly object _gate = new();

    public TrustedReceiverStore(string dataDirectory, string environment)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(environment);
        _path = Path.Combine(dataDirectory, "trusted-windows-receivers.json");
        _environment = environment;
    }

    public IReadOnlyList<TrustedReceiver> Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_path)) return [];
            try
            {
                StoreDocument? document = JsonSerializer.Deserialize<StoreDocument>(
                    File.ReadAllText(_path));
                if (document is null || document.Version != 1 ||
                    !string.Equals(document.Environment, _environment,
                        StringComparison.Ordinal))
                    throw new CryptographicException("The trusted receiver store is invalid.");

                return document.Receivers.Select(item => new TrustedReceiver(
                    item.ServerId, item.Name, _environment, item.Address,
                    item.HttpsPort, item.CertificateFingerprint,
                    Encoding.UTF8.GetString(Unprotect(
                        Convert.FromBase64String(item.ProtectedCredential))),
                    item.LastSeen)).ToArray();
            }
            catch (Exception exception) when (exception is JsonException or
                IOException or FormatException or Win32Exception or CryptographicException)
            {
                throw new NativeClientException("trust_store_corrupt",
                    "Saved receiver trust could not be read. Forget the receiver and pair again.",
                    false, exception);
            }
        }
    }

    public void Upsert(TrustedReceiver receiver)
    {
        if (!string.Equals(receiver.Environment, _environment,
            StringComparison.Ordinal))
            throw new ArgumentException("Receiver environment does not match the store.");
        lock (_gate)
        {
            var receivers = Load().Where(item => item.ServerId != receiver.ServerId).ToList();
            receivers.Add(receiver);
            Save(receivers);
        }
    }

    public void Forget(string serverId)
    {
        lock (_gate)
        {
            Save(Load().Where(item => item.ServerId != serverId));
        }
    }

    public void ClearAfterUserConfirmation()
    {
        lock (_gate)
        {
            if (File.Exists(_path)) File.Delete(_path);
        }
    }

    private void Save(IEnumerable<TrustedReceiver> receivers)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var document = new StoreDocument
        {
            Version = 1,
            Environment = _environment,
            Receivers = receivers.Select(item => new StoredReceiver
            {
                ServerId = item.ServerId,
                Name = item.Name,
                Address = item.Address,
                HttpsPort = item.HttpsPort,
                CertificateFingerprint = item.CertificateFingerprint,
                ProtectedCredential = Convert.ToBase64String(Protect(
                    Encoding.UTF8.GetBytes(item.Credential))),
                LastSeen = item.LastSeen
            }).ToList()
        };
        string temporary = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(document,
                new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temporary, _path, true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }

    private byte[] Protect(byte[] data) => Transform(data, protect: true);
    private byte[] Unprotect(byte[] data) => Transform(data, protect: false);

    private byte[] Transform(byte[] input, bool protect)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows DPAPI is required.");
        byte[] entropy = Encoding.UTF8.GetBytes(
            "LocalMediaTransfer.WindowsClient.Trust.v1|" + _environment);
        DataBlob inputBlob = default;
        DataBlob entropyBlob = default;
        DataBlob outputBlob = default;
        try
        {
            inputBlob = DataBlob.FromBytes(input);
            entropyBlob = DataBlob.FromBytes(entropy);
            bool success = protect
                ? CryptProtectData(ref inputBlob, "Local Media Transfer receiver trust",
                    ref entropyBlob, IntPtr.Zero, IntPtr.Zero,
                    CryptProtectUiForbidden, out outputBlob)
                : CryptUnprotectData(ref inputBlob, IntPtr.Zero, ref entropyBlob,
                    IntPtr.Zero, IntPtr.Zero, CryptProtectUiForbidden, out outputBlob);
            if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
            byte[] output = new byte[outputBlob.Length];
            Marshal.Copy(outputBlob.Data, output, 0, output.Length);
            return output;
        }
        finally
        {
            inputBlob.Free(); entropyBlob.Free();
            if (outputBlob.Data != IntPtr.Zero) LocalFree(outputBlob.Data);
            CryptographicOperations.ZeroMemory(entropy);
        }
    }

    private sealed class StoreDocument
    {
        public int Version { get; set; }
        public string Environment { get; set; } = "";
        public List<StoredReceiver> Receivers { get; set; } = [];
    }

    private sealed class StoredReceiver
    {
        public string ServerId { get; set; } = "";
        public string Name { get; set; } = "";
        public string Address { get; set; } = "";
        public int HttpsPort { get; set; }
        public string CertificateFingerprint { get; set; } = "";
        public string ProtectedCredential { get; set; } = "";
        public DateTimeOffset LastSeen { get; set; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int Length;
        public IntPtr Data;
        public static DataBlob FromBytes(byte[] bytes)
        {
            var blob = new DataBlob { Length = bytes.Length,
                Data = Marshal.AllocHGlobal(bytes.Length) };
            Marshal.Copy(bytes, 0, blob.Data, bytes.Length);
            return blob;
        }
        public void Free()
        {
            if (Data == IntPtr.Zero) return;
            Span<byte> zero = Length <= 1024 ? stackalloc byte[Length] : new byte[Length];
            Marshal.Copy(zero.ToArray(), 0, Data, Length);
            Marshal.FreeHGlobal(Data); Data = IntPtr.Zero; Length = 0;
        }
    }

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref DataBlob input,
        string description, ref DataBlob entropy, IntPtr reserved,
        IntPtr prompt, uint flags, out DataBlob output);
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref DataBlob input,
        IntPtr description, ref DataBlob entropy, IntPtr reserved,
        IntPtr prompt, uint flags, out DataBlob output);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}

public sealed class ClientIdentityStore
{
    private readonly string _path;
    public ClientIdentityStore(string dataDirectory) =>
        _path = Path.Combine(dataDirectory, "windows-client-id.txt");

    public string LoadOrCreate()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        if (File.Exists(_path) && Guid.TryParse(File.ReadAllText(_path).Trim(), out Guid saved))
            return saved.ToString("D");
        string created = Guid.NewGuid().ToString("D");
        string temporary = _path + ".tmp";
        File.WriteAllText(temporary, created);
        try { File.Move(temporary, _path); }
        catch (IOException) when (File.Exists(_path)) { File.Delete(temporary); }
        return Guid.TryParse(File.ReadAllText(_path).Trim(), out saved)
            ? saved.ToString("D") : throw new IOException("Client identity is invalid.");
    }
}
