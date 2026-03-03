using System.Text.Json;

namespace Aski.NativeClient.StreamViewer;

public sealed class StreamPredictionsPoller : IAsyncDisposable
{
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly TimeSpan _pollInterval;
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private CancellationTokenSource? _cts;
    private Task? _pollTask;
    private bool _disposed;

    public StreamPredictionsPoller(HttpClient? httpClient = null, TimeSpan? pollInterval = null)
    {
        _httpClient = httpClient ?? new HttpClient();
        _ownsHttpClient = httpClient is null;
        _pollInterval = pollInterval ?? TimeSpan.FromMilliseconds(400);
    }

    public bool IsRunning => _pollTask is { IsCompleted: false };

    public event Action<JsonElement>? SnapshotReceived;
    public event Action<Exception>? PollingError;

    public async Task StartAsync(
        string predictionsUrl,
        CancellationToken cancellationToken = default
    )
    {
        ThrowIfDisposed();
        if (string.IsNullOrWhiteSpace(predictionsUrl))
        {
            throw new ArgumentException("predictionsUrl is required.", nameof(predictionsUrl));
        }

        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (IsRunning)
            {
                return;
            }

            _cts = new CancellationTokenSource();
            _pollTask = Task.Run(
                () => PollLoopAsync(predictionsUrl, _cts.Token),
                CancellationToken.None
            );
        }
        finally
        {
            _stateGate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (!IsRunning)
            {
                return;
            }

            _cts?.Cancel();
        }
        finally
        {
            _stateGate.Release();
        }

        if (_pollTask is not null)
        {
            try
            {
                await _pollTask;
            }
            catch (OperationCanceledException)
            {
                // expected
            }
        }

        _cts?.Dispose();
        _cts = null;
        _pollTask = null;
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        await StopAsync();
        _stateGate.Dispose();
        if (_ownsHttpClient)
        {
            _httpClient.Dispose();
        }
    }

    private async Task PollLoopAsync(string predictionsUrl, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var response = await _httpClient.GetAsync(predictionsUrl, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                    using var json = await JsonDocument.ParseAsync(
                        stream,
                        cancellationToken: cancellationToken
                    );
                    SnapshotReceived?.Invoke(json.RootElement.Clone());
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                PollingError?.Invoke(ex);
            }

            try
            {
                await Task.Delay(_pollInterval, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(StreamPredictionsPoller));
        }
    }
}
