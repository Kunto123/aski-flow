namespace Aski.NativeClient.CameraService;

public sealed class CameraPipelineSession : IAsyncDisposable
{
    private readonly ICameraFrameSource _frameSource;
    private readonly CameraFrameUploader _frameUploader;
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private CancellationTokenSource? _pipelineCts;
    private bool _started;

    public CameraPipelineSession(ICameraFrameSource frameSource, CameraFrameUploader frameUploader)
    {
        _frameSource = frameSource ?? throw new ArgumentNullException(nameof(frameSource));
        _frameUploader = frameUploader ?? throw new ArgumentNullException(nameof(frameUploader));
    }

    public bool IsStarted => _started;

    public async Task StartAsync(
        CameraPipelineOptions options,
        CancellationToken cancellationToken = default
    )
    {
        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (_started)
            {
                return;
            }

            _pipelineCts = new CancellationTokenSource();
            _frameUploader.UpdateOptions(options);
            _frameUploader.Start();
            _frameSource.FrameReady += OnFrameReady;
            await _frameSource.StartAsync(options, cancellationToken);
            _started = true;
        }
        finally
        {
            _stateGate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (!_started)
            {
                return;
            }

            _started = false;
            _frameSource.FrameReady -= OnFrameReady;
            _frameUploader.Stop();
            _pipelineCts?.Cancel();
            _pipelineCts?.Dispose();
            _pipelineCts = null;
        }
        finally
        {
            _stateGate.Release();
        }

        await _frameSource.StopAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        await _frameSource.DisposeAsync();
        await _frameUploader.DisposeAsync();
        _stateGate.Dispose();
    }

    private void OnFrameReady(CameraFrame frame)
    {
        var token = _pipelineCts?.Token ?? CancellationToken.None;
        _ = _frameUploader.OnFrameAsync(frame, token);
    }
}
