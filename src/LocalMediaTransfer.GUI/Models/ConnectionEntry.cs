using Microsoft.UI.Xaml.Media;

namespace LocalMediaTransfer.GUI.Models
{
    public sealed class ConnectionEntry
    {
        public string Icon { get; set; } = "\uE703";
        public Brush IconColor { get; set; } = null!;
        public string DeviceInfo { get; set; } = "";
        public string IpAddress { get; set; } = "";
        public string Time { get; set; } = "";
    }
}
