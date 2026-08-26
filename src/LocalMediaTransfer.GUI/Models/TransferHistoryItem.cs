namespace LocalMediaTransfer.GUI.Models
{
    public sealed class TransferHistoryItem
    {
        public string Title { get; set; } = "";
        public string Outcome { get; set; } = "";
        public string ContentBreakdown { get; set; } = "";
        public string UploadedSize { get; set; } = "";
        public string AverageSpeed { get; set; } = "";
        public string PeakSpeed { get; set; } = "";
        public string Time { get; set; } = "";
    }
}
