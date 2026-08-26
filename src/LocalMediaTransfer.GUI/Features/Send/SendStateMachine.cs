namespace LocalMediaTransfer.GUI.Features.Send;

public enum SendState
{
    Consent,
    Searching,
    ReceiverSelected,
    Pairing,
    Connected,
    FileSelection,
    Preparing,
    WaitingForApproval,
    Uploading,
    Completed,
    Mixed,
    Cancelled,
    Error
}

public static class SendStateMachine
{
    public static bool CanSelectFiles(SendState state) => state is
        SendState.Connected or SendState.FileSelection or SendState.Completed or
        SendState.Mixed or SendState.Cancelled or SendState.Error;

    public static bool CanSend(SendState state, int fileCount) =>
        fileCount > 0 && state is SendState.FileSelection or SendState.Completed or
            SendState.Mixed or SendState.Cancelled or SendState.Error;
}
