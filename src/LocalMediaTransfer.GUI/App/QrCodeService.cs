using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml.Media.Imaging;
using QRCoder;
using Windows.Storage.Streams;
using System.Runtime.InteropServices.WindowsRuntime;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class QrCodeService
    {
        public static async Task<BitmapImage> CreateBitmapAsync(string payload)
        {
            using var qrGenerator = new QRCodeGenerator();
            using var qrCodeData = qrGenerator.CreateQrCode(payload, QRCodeGenerator.ECCLevel.Q);
            using var qrCode = new PngByteQRCode(qrCodeData);
            byte[] qrCodeBytes = qrCode.GetGraphic(10);

            var bitmap = new BitmapImage();
            using var stream = new InMemoryRandomAccessStream();
            await stream.WriteAsync(qrCodeBytes.AsBuffer());
            stream.Seek(0);
            await bitmap.SetSourceAsync(stream);
            return bitmap;
        }
    }
}
