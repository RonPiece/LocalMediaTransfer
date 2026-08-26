using System;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace LocalMediaTransfer.GUI.Services
{
    /// <summary>
    /// Shared network helpers for selecting a practical local interface/address.
    /// </summary>
    public static class NetworkUtils
    {
        private static readonly string[] VirtualInterfaceHints =
        {
            "virtual",
            "vmware",
            "hyper-v",
            "tailscale",
            "zerotier",
            "wireguard",
            "vpn",
            "vEthernet"
        };

        public static string GetLocalIpv4OrLoopback()
        {
            return TryGetPrimaryInterface(out _, out var ipAddress)
                ? ipAddress.ToString()
                : "127.0.0.1";
        }

        public static bool TryGetPrimaryInterface(out NetworkInterface? networkInterface, out IPAddress ipAddress)
        {
            foreach (var iface in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (!IsEligibleInterface(iface))
                {
                    continue;
                }

                var properties = iface.GetIPProperties();
                foreach (var candidate in properties.UnicastAddresses)
                {
                    if (candidate.Address.AddressFamily != AddressFamily.InterNetwork)
                    {
                        continue;
                    }

                    networkInterface = iface;
                    ipAddress = candidate.Address;
                    return true;
                }
            }

            networkInterface = null;
            ipAddress = IPAddress.Loopback;
            return false;
        }

        private static bool IsEligibleInterface(NetworkInterface iface)
        {
            if (iface.OperationalStatus != OperationalStatus.Up)
            {
                return false;
            }

            if (iface.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                iface.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
            {
                return false;
            }

            foreach (var hint in VirtualInterfaceHints)
            {
                if (iface.Description.Contains(hint, StringComparison.OrdinalIgnoreCase) ||
                    iface.Name.Contains(hint, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            return true;
        }
    }
}
