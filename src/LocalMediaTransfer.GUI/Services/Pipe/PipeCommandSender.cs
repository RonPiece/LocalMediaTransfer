using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace LocalMediaTransfer.GUI.Services
{
    internal readonly record struct PipeSendResult(bool Success, string? FailureReason)
    {
        public static PipeSendResult Ok() => new(true, null);
        public static PipeSendResult Failed(string reason) => new(false, reason);
    }

    internal static class PipeCommandSender
    {
        public static async Task<PipeSendResult> SendAsync(
            NamedPipeClientStream pipe,
            SemaphoreSlim writeLock,
            string type,
            string data,
            string? requestId = null)
        {
            bool lockTaken = false;

            try
            {
                if (!await writeLock.WaitAsync(TimeSpan.FromSeconds(1)))
                {
                    return PipeSendResult.Failed("write lock timeout");
                }

                lockTaken = true;

                if (!pipe.IsConnected)
                {
                    return PipeSendResult.Failed("pipe disconnected");
                }

                var json = requestId == null
                    ? JsonSerializer.Serialize(new { type, data })
                    : JsonSerializer.Serialize(new { type, data, requestId });
                var bytes = Encoding.UTF8.GetBytes(json);
                await pipe.WriteAsync(bytes, 0, bytes.Length);
                await pipe.FlushAsync();
                return PipeSendResult.Ok();
            }
            catch (IOException)
            {
                return PipeSendResult.Failed("pipe IO error");
            }
            catch (ObjectDisposedException)
            {
                return PipeSendResult.Failed("pipe disposed");
            }
            finally
            {
                if (lockTaken)
                {
                    writeLock.Release();
                }
            }
        }
    }
}
