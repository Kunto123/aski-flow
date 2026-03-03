using System.Collections.Concurrent;
using System.Text.Json;
using Aski.NativeClient.SocketService;

namespace Aski.NativeClient.StreamViewer;

public sealed class StreamViewerController : IAsyncDisposable
{
    private readonly OutputInterpreter _outputInterpreter;
    private readonly StreamUrlResolver _urlResolver;
    private readonly TimeSpan _pollInterval;
    private readonly ConcurrentDictionary<string, NodeOutputState> _states = new(
        StringComparer.OrdinalIgnoreCase
    );
    private readonly ConcurrentDictionary<string, StreamPredictionsPoller> _pollers = new(
        StringComparer.OrdinalIgnoreCase
    );
    private readonly ConcurrentDictionary<string, string> _pollerUrls = new(
        StringComparer.OrdinalIgnoreCase
    );
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private IFlowSocketClient? _socketClient;
    private bool _disposed;

    public StreamViewerController(
        OutputInterpreter outputInterpreter,
        StreamUrlResolver urlResolver,
        TimeSpan? pollInterval = null
    )
    {
        _outputInterpreter = outputInterpreter ?? throw new ArgumentNullException(nameof(outputInterpreter));
        _urlResolver = urlResolver ?? throw new ArgumentNullException(nameof(urlResolver));
        _pollInterval = pollInterval ?? TimeSpan.FromMilliseconds(400);
    }

    public event Action<NodeOutputState>? NodeStateChanged;

    public IReadOnlyDictionary<string, NodeOutputState> SnapshotStates()
        => new Dictionary<string, NodeOutputState>(_states, StringComparer.OrdinalIgnoreCase);

    public NodeOutputState? GetNodeState(string nodeName)
    {
        if (string.IsNullOrWhiteSpace(nodeName))
        {
            return null;
        }

        return _states.TryGetValue(nodeName, out var state) ? state : null;
    }

    public async Task AttachSocketAsync(
        IFlowSocketClient socketClient,
        CancellationToken cancellationToken = default
    )
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(socketClient);

        await _lifecycleGate.WaitAsync(cancellationToken);
        try
        {
            if (ReferenceEquals(_socketClient, socketClient))
            {
                return;
            }

            if (_socketClient is not null)
            {
                UnsubscribeSocket(_socketClient);
            }

            _socketClient = socketClient;
            SubscribeSocket(socketClient);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task DetachSocketAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        await _lifecycleGate.WaitAsync(cancellationToken);
        try
        {
            if (_socketClient is null)
            {
                return;
            }

            UnsubscribeSocket(_socketClient);
            _socketClient = null;
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        await DetachSocketAsync();
        await StopAllPollersAsync();
        _lifecycleGate.Dispose();
    }

    private void SubscribeSocket(IFlowSocketClient socketClient)
    {
        socketClient.ProgressReceived += OnProgressReceived;
        socketClient.ErrorReceived += OnErrorReceived;
        socketClient.RunEndReceived += OnRunEndReceived;
        socketClient.Disconnected += OnDisconnected;
    }

    private void UnsubscribeSocket(IFlowSocketClient socketClient)
    {
        socketClient.ProgressReceived -= OnProgressReceived;
        socketClient.ErrorReceived -= OnErrorReceived;
        socketClient.RunEndReceived -= OnRunEndReceived;
        socketClient.Disconnected -= OnDisconnected;
    }

    private void OnProgressReceived(FlowProgressEvent progress)
    {
        var nodeName = progress.InstanceName ?? string.Empty;
        if (string.IsNullOrWhiteSpace(nodeName))
        {
            return;
        }

        var interpreted = _outputInterpreter.Interpret(progress.Output);
        var (mjpegUrl, predictionsUrl) = ResolveStreamUrls(interpreted);
        var state = new NodeOutputState(
            NodeName: nodeName,
            IsRunning: !progress.IsDone,
            Items: interpreted,
            MjpegUrl: mjpegUrl,
            PredictionsUrl: predictionsUrl,
            PredictionsSnapshot: TryGetExistingPredictions(nodeName),
            Error: null,
            UpdatedAtUtc: DateTimeOffset.UtcNow
        );

        _states[nodeName] = state;
        NodeStateChanged?.Invoke(state);

        _ = EnsurePollerStateAsync(nodeName, predictionsUrl);
    }

    private void OnErrorReceived(FlowErrorEvent error)
    {
        var nodeName = !string.IsNullOrWhiteSpace(error.InstanceName)
            ? error.InstanceName
            : error.NodeName;
        if (string.IsNullOrWhiteSpace(nodeName))
        {
            return;
        }

        var previous = GetNodeState(nodeName);
        var state = (previous ?? new NodeOutputState(nodeName, false, Array.Empty<NativeOutputItem>())) with
        {
            IsRunning = false,
            Error = string.IsNullOrWhiteSpace(error.Error) ? "Unknown error" : error.Error,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        _states[nodeName] = state;
        NodeStateChanged?.Invoke(state);
        _ = StopPollerAsync(nodeName);
    }

    private void OnRunEndReceived(FlowRunEndEvent _)
    {
        foreach (var kvp in _states.ToArray())
        {
            var state = kvp.Value with
            {
                IsRunning = false,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
            _states[kvp.Key] = state;
            NodeStateChanged?.Invoke(state);
        }
    }

    private void OnDisconnected(string? _)
    {
        foreach (var kvp in _states.ToArray())
        {
            var state = kvp.Value with
            {
                IsRunning = false,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
            _states[kvp.Key] = state;
            NodeStateChanged?.Invoke(state);
        }
    }

    private (string? mjpegUrl, string? predictionsUrl) ResolveStreamUrls(
        IReadOnlyList<NativeOutputItem> outputs
    )
    {
        foreach (var item in outputs)
        {
            if (item.Kind != NativeOutputKind.Stream)
            {
                continue;
            }

            var source = item.StreamId ?? item.Url ?? item.Text;
            if (string.IsNullOrWhiteSpace(source))
            {
                continue;
            }

            try
            {
                var mjpeg = _urlResolver.ResolveMjpegUrl(source);
                var predictions = _urlResolver.ResolvePredictionsUrl(source);
                return (mjpeg, predictions);
            }
            catch
            {
                // Continue to next stream candidate.
            }
        }

        return (null, null);
    }

    private JsonElement? TryGetExistingPredictions(string nodeName)
    {
        if (_states.TryGetValue(nodeName, out var existing))
        {
            return existing.PredictionsSnapshot;
        }

        return null;
    }

    private async Task EnsurePollerStateAsync(string nodeName, string? predictionsUrl)
    {
        if (string.IsNullOrWhiteSpace(nodeName))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(predictionsUrl))
        {
            await StopPollerAsync(nodeName);
            return;
        }

        if (
            _pollerUrls.TryGetValue(nodeName, out var existingUrl)
            && !string.Equals(existingUrl, predictionsUrl, StringComparison.OrdinalIgnoreCase)
        )
        {
            await StopPollerAsync(nodeName);
        }

        var poller = _pollers.GetOrAdd(
            nodeName,
            _ =>
            {
                var created = new StreamPredictionsPoller(pollInterval: _pollInterval);
                created.SnapshotReceived += snapshot => OnPredictionsSnapshot(nodeName, snapshot);
                created.PollingError += error => OnPredictionsError(nodeName, error);
                return created;
            }
        );
        _pollerUrls[nodeName] = predictionsUrl;

        if (!poller.IsRunning)
        {
            await poller.StartAsync(predictionsUrl);
        }
    }

    private async Task StopPollerAsync(string nodeName)
    {
        if (!_pollers.TryRemove(nodeName, out var poller))
        {
            _pollerUrls.TryRemove(nodeName, out _);
            return;
        }

        _pollerUrls.TryRemove(nodeName, out _);
        await poller.DisposeAsync();
    }

    private async Task StopAllPollersAsync()
    {
        foreach (var key in _pollers.Keys.ToArray())
        {
            await StopPollerAsync(key);
        }
    }

    private void OnPredictionsSnapshot(string nodeName, JsonElement snapshot)
    {
        if (!_states.TryGetValue(nodeName, out var previous))
        {
            return;
        }

        var updated = previous with
        {
            PredictionsSnapshot = snapshot.Clone(),
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };
        _states[nodeName] = updated;
        NodeStateChanged?.Invoke(updated);
    }

    private void OnPredictionsError(string nodeName, Exception error)
    {
        if (!_states.TryGetValue(nodeName, out var previous))
        {
            return;
        }

        var updated = previous with
        {
            Error = $"Predictions polling failed: {error.Message}",
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };
        _states[nodeName] = updated;
        NodeStateChanged?.Invoke(updated);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(StreamViewerController));
        }
    }
}
