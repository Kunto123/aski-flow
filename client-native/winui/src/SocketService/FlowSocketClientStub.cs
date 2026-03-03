using Aski.NativeClient.Settings;

namespace Aski.NativeClient.SocketService;

public sealed class FlowSocketClientStub : IFlowSocketClient
{
    private readonly NativeClientSettings _settings;

    public FlowSocketClientStub(NativeClientSettings settings)
    {
        _settings = settings.Normalize();
    }

    public bool IsConnected => false;
    public string? SessionId => null;

#pragma warning disable CS0067
    public event Action? Connected;
    public event Action<string?>? Disconnected;
    public event Action<FlowProgressEvent>? ProgressReceived;
    public event Action<FlowErrorEvent>? ErrorReceived;
    public event Action<FlowRunEndEvent>? RunEndReceived;
    public event Action<FlowCurrentNodeRunningEvent>? CurrentNodeRunningReceived;
#pragma warning restore CS0067

    public Task ConnectAsync(CancellationToken cancellationToken = default)
        => throw BuildNotReadyException("ConnectAsync");

    public Task DisconnectAsync(CancellationToken cancellationToken = default)
        => Task.CompletedTask;

    public Task EmitRunNodeAsync(
        RunNodeRequest request,
        CancellationToken cancellationToken = default
    )
        => throw BuildNotReadyException("EmitRunNodeAsync");

    public Task EmitProcessFileAsync(
        ProcessFileRequest request,
        CancellationToken cancellationToken = default
    )
        => throw BuildNotReadyException("EmitProcessFileAsync");

    public Task EmitUpdateAppConfigAsync(
        IReadOnlyDictionary<string, string> appConfig,
        CancellationToken cancellationToken = default
    )
        => throw BuildNotReadyException("EmitUpdateAppConfigAsync");

    public ValueTask DisposeAsync()
        => ValueTask.CompletedTask;

    private NotSupportedException BuildNotReadyException(string operationName)
    {
        var endpoint = _settings.BuildSocketUrl();
        return new NotSupportedException(
            $"Socket transport is not wired yet for native client. " +
            $"Operation '{operationName}' cannot run. Expected endpoint: {endpoint}. " +
            "Next step: add Socket.IO transport implementation against IFlowSocketClient."
        );
    }
}
