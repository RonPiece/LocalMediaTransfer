using CommunityToolkit.Mvvm.ComponentModel;
using LocalMediaTransfer.GUI.AppServices;
using LocalMediaTransfer.GUI.Services;
using System;
using System.Net.NetworkInformation;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Features.Network
{
    public sealed class NetworkViewModel : ObservableObject
    {
        private string _ipv4Address = "";
        public string Ipv4Address
        {
            get => _ipv4Address;
            set => SetProperty(ref _ipv4Address, value);
        }

        private string _serverPort = "";
        public string ServerPort
        {
            get => _serverPort;
            set => SetProperty(ref _serverPort, value);
        }

        private string _fullUrl = "";
        public string FullUrl
        {
            get => _fullUrl;
            set => SetProperty(ref _fullUrl, value);
        }

        private string _connectionType = "Unknown";
        public string ConnectionType
        {
            get => _connectionType;
            set => SetProperty(ref _connectionType, value);
        }

        private string _connectionDescription = "Not connected to a known network type.";
        public string ConnectionDescription
        {
            get => _connectionDescription;
            set => SetProperty(ref _connectionDescription, value);
        }

        private string _connectionGlyph = "\uE774";
        public string ConnectionGlyph
        {
            get => _connectionGlyph;
            set => SetProperty(ref _connectionGlyph, value);
        }

        public void Refresh(ServerManager? serverManager)
        {
            try
            {
                string ip = NetworkUtils.GetLocalIpv4OrLoopback();
                int port = serverManager?.Port ?? ServerManager.DefaultPort;
                Ipv4Address = ip;
                ServerPort = port.ToString();
                FullUrl = $"https://{ip}:{port}";
            }
            catch (Exception)
            {
                Ipv4Address = "Error";
                ServerPort = "";
                FullUrl = "";
            }

            DetectConnectionType();
        }

        public void CopyNetworkUrl() => ClipboardService.SetText(FullUrl);

        public async Task RestartServerAsync(MainWindow mainWindow)
        {
            await mainWindow.RestartServerAsync("Server restarted.", suppressDisconnectLog: true);
            Refresh(mainWindow.ServerManager);
        }

        public async Task StopServerAsync(MainWindow mainWindow)
        {
            bool wasActive = mainWindow.ServerManager.State is
                ServerManagerState.Starting or ServerManagerState.Running;
            await mainWindow.ServerManager.StopAsync();
            mainWindow.AddNetworkLog(wasActive ? "Server stopped." : "Server was already stopped.");
        }

        private void DetectConnectionType()
        {
            if (NetworkUtils.TryGetPrimaryInterface(out var iface, out _))
            {
                var interfaceType = iface?.NetworkInterfaceType;
                ConnectionType = FriendlyInterfaceName(interfaceType);
                ConnectionDescription = iface?.Description ?? "Connected";
                ConnectionGlyph = GlyphForInterface(interfaceType);
                return;
            }

            ConnectionType = "Unknown";
            ConnectionDescription = "Not connected to a known network type.";
            ConnectionGlyph = "\uE774";
        }

        private static string FriendlyInterfaceName(NetworkInterfaceType? type) => type switch
        {
            NetworkInterfaceType.Wireless80211 => "Wi-Fi",
            NetworkInterfaceType.Ethernet => "Ethernet",
            NetworkInterfaceType.GigabitEthernet => "Ethernet",
            NetworkInterfaceType.FastEthernetFx => "Ethernet",
            NetworkInterfaceType.FastEthernetT => "Ethernet",
            null => "Unknown",
            _ => type.Value.ToString()
        };

        private static string GlyphForInterface(NetworkInterfaceType? type) => type switch
        {
            NetworkInterfaceType.Wireless80211 => "\uE701",
            NetworkInterfaceType.Ethernet or
            NetworkInterfaceType.GigabitEthernet or
            NetworkInterfaceType.FastEthernetFx or
            NetworkInterfaceType.FastEthernetT => "\uE839",
            _ => "\uE774"
        };
    }
}
