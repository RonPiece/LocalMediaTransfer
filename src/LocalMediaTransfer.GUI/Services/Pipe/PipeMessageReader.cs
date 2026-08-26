using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    internal static class PipeMessageReader
    {
        public const int ReadBufferSize = 4096;
        public const int MaxMessageBytes = 512 * 1024;

        public static async Task<PipeReadResult> ReadMessageAsync(
            NamedPipeClientStream pipe,
            byte[] buffer,
            CancellationToken ct)
        {
            using var messageStream = new MemoryStream();

            do
            {
                int bytesRead = await pipe.ReadAsync(buffer, 0, buffer.Length, ct);
                if (bytesRead == 0)
                {
                    return PipeReadResult.Disconnected();
                }

                messageStream.Write(buffer, 0, bytesRead);
                if (messageStream.Length > MaxMessageBytes)
                {
                    return PipeReadResult.TooLarge();
                }
            }
            while (!pipe.IsMessageComplete);

            return PipeReadResult.FromMessage(Encoding.UTF8.GetString(messageStream.ToArray()));
        }
    }

    internal readonly record struct PipeReadResult(
        PipeReadStatus Status,
        string? Message)
    {
        public static PipeReadResult FromMessage(string message) =>
            new(PipeReadStatus.Message, message);

        public static PipeReadResult Disconnected() =>
            new(PipeReadStatus.Disconnected, null);

        public static PipeReadResult TooLarge() =>
            new(PipeReadStatus.TooLarge, null);
    }

    internal enum PipeReadStatus
    {
        Message,
        Disconnected,
        TooLarge
    }
}
