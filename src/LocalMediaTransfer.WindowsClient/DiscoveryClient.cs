using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace LocalMediaTransfer.WindowsClient;

public sealed class DiscoveryClient
{
    private const int MaxDestinations = 1024;
    private static readonly string[] VirtualInterfaceHints =
    [
        "virtual", "vmware", "hyper-v", "vethernet", "tailscale",
        "zerotier", "wireguard", "vpn", "teamviewer"
    ];

    internal sealed record DiscoverySubnet(
        IPAddress Address,
        IPAddress Mask,
        NetworkInterfaceType InterfaceType,
        string Name,
        string Description,
        bool HasGateway);

    public async Task<IReadOnlyList<DiscoveredReceiver>> ScanAsync(
        string environment, int discoveryPort, CancellationToken cancellationToken)
    {
        var destinations = EnumerateDestinations().ToArray();
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
        var subnets = new List<DiscoverySubnet>();
        foreach (NetworkInterface network in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (network.OperationalStatus != OperationalStatus.Up)
                continue;
            IPInterfaceProperties properties;
            try { properties = network.GetIPProperties(); }
            catch (NetworkInformationException) { continue; }
            bool hasGateway = properties.GatewayAddresses.Any(gateway =>
                gateway.Address.AddressFamily == AddressFamily.InterNetwork &&
                !gateway.Address.Equals(IPAddress.Any));
            foreach (UnicastIPAddressInformation unicast in properties.UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork ||
                    unicast.IPv4Mask is null || !IsPrivate(unicast.Address)) continue;
                subnets.Add(new DiscoverySubnet(
                    unicast.Address,
                    unicast.IPv4Mask,
                    network.NetworkInterfaceType,
                    network.Name,
                    network.Description,
                    hasGateway));
            }
        }
        return EnumerateDestinations(subnets);
    }

    internal static IReadOnlyList<IPAddress> EnumerateDestinations(
        IEnumerable<DiscoverySubnet> subnets)
    {
        var candidates = subnets
            .Where(subnet => ShouldScanInterface(
                subnet.InterfaceType, subnet.Name, subnet.Description) &&
                IsPrivate(subnet.Address))
            .OrderByDescending(subnet => subnet.HasGateway)
            .ThenBy(subnet => InterfacePriority(subnet.InterfaceType))
            .Select(subnet => EnumerateSubnet(subnet.Address, subnet.Mask).GetEnumerator())
            .ToList();
        var results = new List<IPAddress>(MaxDestinations);
        var seen = new HashSet<uint>();
        try
        {
            while (candidates.Count > 0 && results.Count < MaxDestinations)
            {
                for (int index = candidates.Count - 1;
                    index >= 0 && results.Count < MaxDestinations;
                    index--)
                {
                    IEnumerator<IPAddress> candidate = candidates[index];
                    if (!candidate.MoveNext())
                    {
                        candidate.Dispose();
                        candidates.RemoveAt(index);
                        continue;
                    }
                    if (seen.Add(ToUInt32(candidate.Current)))
                        results.Add(candidate.Current);
                }
            }
        }
        finally
        {
            foreach (IEnumerator<IPAddress> candidate in candidates)
                candidate.Dispose();
        }
        return results;
    }

    internal static bool ShouldScanInterface(
        NetworkInterfaceType type,
        string name,
        string description)
    {
        if (type is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            return false;
        string identity = name + " " + description;
        return !VirtualInterfaceHints.Any(hint =>
            identity.Contains(hint, StringComparison.OrdinalIgnoreCase));
    }

    private static int InterfacePriority(NetworkInterfaceType type) => type switch
    {
        NetworkInterfaceType.Wireless80211 => 0,
        NetworkInterfaceType.Ethernet or
        NetworkInterfaceType.GigabitEthernet or
        NetworkInterfaceType.FastEthernetFx or
        NetworkInterfaceType.FastEthernetT => 1,
        _ => 2
    };

    private static IEnumerable<IPAddress> EnumerateSubnet(
        IPAddress address,
        IPAddress ipv4Mask)
    {
        uint local = ToUInt32(address);
        uint mask = ToUInt32(ipv4Mask);
        uint hostMask = ~mask;
        if (hostMask < 2 || (hostMask & (hostMask + 1)) != 0)
            yield break;
        uint networkAddress = local & mask;
        uint broadcast = networkAddress | hostMask;
        uint first = networkAddress + 1;
        uint last = broadcast - 1;
        ulong available = (ulong)last - first + 1;
        if (available > MaxDestinations)
        {
            ulong halfWindow = MaxDestinations / 2;
            first = local > halfWindow
                ? Math.Max(first, local - (uint)halfWindow)
                : first;
            last = Math.Min(last, first + MaxDestinations - 1);
            if ((ulong)last - first + 1 < MaxDestinations && last == broadcast - 1)
                first = Math.Max(networkAddress + 1,
                    last - (MaxDestinations - 1));
        }
        for (uint candidate = first; candidate <= last; candidate++)
        {
            if (candidate != local) yield return FromUInt32(candidate);
            if (candidate == uint.MaxValue) yield break;
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
