using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

public sealed class DiscoveryClient
{
    private const int MaxDestinations = 1024;

    public async Task<IReadOnlyList<DiscoveredReceiver>> ScanAsync(
        string environment, int discoveryPort, CancellationToken cancellationToken)
    {
        var destinations = EnumerateDestinations().Take(MaxDestinations).ToArray();
        using var udp = new UdpClient(AddressFamily.InterNetwork);
        byte[] query = Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new { type = "lmt-discovery-query", version = 2 }));
        foreach (IPAddress address in destinations)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try { await udp.SendAsync(query, new IPEndPoint(address, discoveryPort), cancellationToken); }
            catch (SocketException) { }
        }

        var results = new Dictionary<string, DiscoveredReceiver>(StringComparer.Ordinal);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        while (!timeout.IsCancellationRequested)
        {
            try
            {
                UdpReceiveResult packet = await udp.ReceiveAsync(timeout.Token);
                DiscoveredReceiver? receiver = ParseResponse(packet.Buffer,
                    packet.RemoteEndPoint.Address, environment);
                if (receiver is not null)
                    results[$"{receiver.ServerId}|{receiver.Address}"] = receiver;
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested) { break; }
            catch (SocketException) { }
        }
        return results.Values.OrderBy(value => value.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
    }

    public static bool TryParseManualAddress(string value, int defaultPort,
        out string address, out int port)
    {
        address = "";
        port = defaultPort;
        string candidate = value.Trim();
        if (Uri.TryCreate(candidate.Contains("://", StringComparison.Ordinal)
                ? candidate : "https://" + candidate, UriKind.Absolute, out Uri? uri) &&
            uri.Scheme == Uri.UriSchemeHttps && IPAddress.TryParse(uri.Host, out IPAddress? ip) &&
            ip.AddressFamily == AddressFamily.InterNetwork && IsPrivate(ip))
        {
            address = ip.ToString();
            port = uri.IsDefaultPort ? defaultPort : uri.Port;
            return port is > 0 and <= 65535;
        }
        return false;
    }

    internal static DiscoveredReceiver? ParseResponse(byte[] payload,
        IPAddress sourceAddress, string environment)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(payload);
            JsonElement root = document.RootElement;
            if (root.GetProperty("type").GetString() != "lmt-discovery-response" ||
                root.GetProperty("version").GetInt32() != 2 ||
                root.GetProperty("environment").GetString() != environment ||
                !IsPrivate(sourceAddress)) return null;
            NativeCapability? capability = null;
            if (root.TryGetProperty("capabilities", out JsonElement capabilities) &&
                capabilities.TryGetProperty("nativeWindowsTransfer", out JsonElement native))
            {
                capability = new NativeCapability(native.GetProperty("version").GetInt32(),
                    native.TryGetProperty("pairingAvailable", out JsonElement available) &&
                    available.GetBoolean());
            }
            return new DiscoveredReceiver(
                root.GetProperty("serverId").GetString() ?? "",
                root.GetProperty("name").GetString() ?? "Windows computer",
                environment, sourceAddress.ToString(),
                root.GetProperty("httpsPort").GetInt32(),
                root.GetProperty("certificateFingerprint").GetString() ?? "",
                capability,
                root.TryGetProperty("httpPort", out JsonElement http) ? http.GetInt32() : null);
        }
        catch (Exception exception) when (exception is JsonException or
            KeyNotFoundException or InvalidOperationException or FormatException or
            OverflowException)
        {
            // Discovery is untrusted and best effort; malformed packets are ignored.
            return null;
        }
    }

    internal static IEnumerable<IPAddress> EnumerateDestinations()
    {
        var seen = new HashSet<uint>();
        foreach (NetworkInterface network in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (network.OperationalStatus != OperationalStatus.Up ||
                network.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
                continue;
            foreach (UnicastIPAddressInformation unicast in network.GetIPProperties().UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork ||
                    unicast.IPv4Mask is null || !IsPrivate(unicast.Address)) continue;
                uint local = ToUInt32(unicast.Address);
                uint mask = ToUInt32(unicast.IPv4Mask);
                uint networkAddress = local & mask;
                uint broadcast = networkAddress | ~mask;
                uint first = networkAddress + 1;
                uint last = broadcast - 1;
                if ((ulong)last - first + 1 > MaxDestinations)
                {
                    first = local > 512 ? Math.Max(first, local - 512) : first;
                    last = Math.Min(last, first + MaxDestinations);
                    if (last - first + 1 < MaxDestinations && last == broadcast - 1)
                        first = Math.Max(networkAddress + 1,
                            last - (MaxDestinations - 1));
                }
                for (uint candidate = first;
                    candidate <= last && seen.Count < MaxDestinations; candidate++)
                {
                    if (candidate != local && seen.Add(candidate)) yield return FromUInt32(candidate);
                }
            }
        }
    }

    internal static bool IsPrivate(IPAddress address)
    {
        byte[] bytes = address.GetAddressBytes();
        return bytes.Length == 4 && (bytes[0] == 10 ||
            (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) ||
            (bytes[0] == 192 && bytes[1] == 168) ||
            (bytes[0] == 169 && bytes[1] == 254));
    }

    private static uint ToUInt32(IPAddress address)
    {
        byte[] bytes = address.GetAddressBytes();
        return ((uint)bytes[0] << 24) | ((uint)bytes[1] << 16) |
            ((uint)bytes[2] << 8) | bytes[3];
    }

    private static IPAddress FromUInt32(uint value) => new(new byte[]
    {
        (byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value
    });
}
