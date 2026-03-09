using Aski.NativeClient.FlowRunner;

namespace Aski.NativeClient.CameraService;

public sealed class CameraFrameUploader : IAsyncDisposable
{
    private readonly AskiRestClient _restClient;
    private readonly string _clientSessionId;
    private readonly SemaphoreSlim _uploadSemaphore;
    private readonly object _stateLock = new();
    private CameraPipelineOptions _options = new();
    private DateTimeOffset _lastUploadAtUtc = DateTimeOffset.MinValue;
    private bool _running;
    private long _uploadedFrameCount;
    private long _droppedFrameCount;

    public CameraFrameUploader(
        AskiRestClient restClient,
        string clientSessionId,
        CameraPipelineOptions? options = null
    )
    {
        _restClient = restClient ?? throw new ArgumentNullException(nameof(restClient));
        _clientSessionId = string.IsNullOrWhiteSpace(clientSessionId)
            ? throw new ArgumentException("clientSessionId is required.", nameof(clientSessionId))
            : clientSessionId;
        _options = options ?? new CameraPipelineOptions();
        _uploadSemaphore = new SemaphoreSlim(Math.Max(1, _options.MaxUploadInFlight), Math.Max(1, _options.MaxUploadInFlight));
    }

    public long UploadedFrameCount => Interlocked.Read(ref _uploadedFrameCount);
    public long DroppedFrameCount => Interlocked.Read(ref _droppedFrameCount);

    public void UpdateOptions(CameraPipelineOptions options)
    {
        _options = options ?? new CameraPipelineOptions();
    }

    public void Start()
    {
        _running = true;
    }

    public void Stop()
    {
        _running = false;
    }

    public Task OnFrameAsync(CameraFrame frame, CancellationToken cancellationToken = default)
    {
        if (!_running)
        {
            return Task.CompletedTask;
        }

        if (!ShouldUploadNow(frame.CapturedAtUtc))
        {
            Interlocked.Increment(ref _droppedFrameCount);
            return Task.CompletedTask;
        }

        _ = UploadInternalAsync(frame, cancellationToken);
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _running = false;
        _uploadSemaphore.Dispose();
        await Task.CompletedTask;
    }

    private bool ShouldUploadNow(DateTimeOffset nowUtc)
    {
        lock (_stateLock)
        {
            if (_options.UploadFps <= 0)
            {
                _lastUploadAtUtc = nowUtc;
                return true;
            }

            var intervalMs = Math.Max(1, (int)Math.Round(1000.0 / Math.Max(1f, _options.UploadFps)));
            if (_lastUploadAtUtc != DateTimeOffset.MinValue)
            {
                var elapsedMs = (nowUtc - _lastUploadAtUtc).TotalMilliseconds;
                if (elapsedMs < intervalMs)
                {
                    return false;
                }
            }

            _lastUploadAtUtc = nowUtc;
            return true;
        }
    }

    private async Task UploadInternalAsync(CameraFrame frame, CancellationToken cancellationToken)
    {
        try
        {
            await _uploadSemaphore.WaitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        try
        {
            await _restClient.IngestClientCameraFrameAsync(
                frame.JpegBytes,
                cameraIndex: _options.CameraIndex,
                width: frame.Width,
                height: frame.Height,
                fps: frame.Fps,
                clientSessionId: _clientSessionId,
                cancellationToken: cancellationToken
            );
            Interlocked.Increment(ref _uploadedFrameCount);
        }
        catch (OperationCanceledException)
        {
            // Ignore cancellation during shutdown.
        }
        catch
        {
            Interlocked.Increment(ref _droppedFrameCount);
        }
        finally
        {
            _uploadSemaphore.Release();
        }
    }
}
