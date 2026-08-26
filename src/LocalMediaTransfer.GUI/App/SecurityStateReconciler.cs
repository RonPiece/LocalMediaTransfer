using System.Threading.Tasks;
using LocalMediaTransfer.GUI.Services;

namespace LocalMediaTransfer.GUI.AppServices
{
    internal static class SecurityStateReconciler
    {
        public static async Task<PipeCommandAcknowledgement> ReconcileAsync(
            PipeClient pipeClient,
            string sessionToken,
            bool autoApproveKnownDevices,
            bool nearbyDiscovery)
        {
            PipeCommandAcknowledgement token =
                await pipeClient.SendTokenAcknowledgedAsync(sessionToken);
            if (!token.Success) return token;

            PipeCommandAcknowledgement autoApprove =
                await pipeClient.SetAutoApproveKnownAcknowledgedAsync(
                    autoApproveKnownDevices);
            if (!autoApprove.Success) return autoApprove;

            return await pipeClient.SetDiscoveryEnabledAcknowledgedAsync(
                nearbyDiscovery);
        }
    }
}
