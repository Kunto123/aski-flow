namespace Aski.NativeClient.SocketService;

public interface IFlowSocketClient : IAsyncDisposable
{
    bool IsConnected { get; }
    string? SessionId { get; }

    event Action? Connected;
    event Action<string?>? Disconnected;
    event Action<FlowProgressEvent>? ProgressReceived;
    event Action<FlowErrorEvent>? ErrorReceived;
    event Action<FlowRunEndEvent>? RunEndReceived;
    event Action<FlowCurrentNodeRunningEvent>? CurrentNodeRunningReceived;

    Task ConnectAsync(CancellationToken cancellationToken = default);
    Task DisconnectAsync(CancellationToken cancellationToken = default);

    Task EmitRunNodeAsync(RunNodeRequest request, CancellationToken cancellationToken = default);
    Task EmitProcessFileAsync(ProcessFileRequest request, CancellationToken cancellationToken = default);
    Task EmitUpdateAppConfigAsync(
        IReadOnlyDictionary<string, string> appConfig,
        CancellationToken cancellationToken = default
    );
}
