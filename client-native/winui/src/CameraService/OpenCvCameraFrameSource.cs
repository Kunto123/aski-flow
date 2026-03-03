using OpenCvSharp;

namespace Aski.NativeClient.CameraService;

public sealed class OpenCvCameraFrameSource : ICameraFrameSource
{
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private VideoCapture? _capture;
    private CancellationTokenSource? _captureCts;
    private Task? _captureTask;
    private bool _disposed;

    public bool IsRunning { get; private set; }

    public event Action<CameraFrame>? FrameReady;

    public async Task StartAsync(
        CameraPipelineOptions options,
        CancellationToken cancellationToken = default
    )
    {
        ThrowIfDisposed();
        options ??= new CameraPipelineOptions();

        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (IsRunning)
            {
                return;
            }

            var capture = new VideoCapture(options.CameraIndex, VideoCaptureAPIs.ANY);
            if (!capture.IsOpened())
            {
                capture.Dispose();
                throw new InvalidOperationException(
                    $"Unable to open camera device at index {options.CameraIndex}."
                );
            }

            if (options.Width > 0)
            {
                capture.Set(VideoCaptureProperties.FrameWidth, options.Width);
            }

            if (options.Height > 0)
            {
                capture.Set(VideoCaptureProperties.FrameHeight, options.Height);
            }

            if (options.UploadFps > 0)
            {
                capture.Set(VideoCaptureProperties.Fps, options.UploadFps);
            }

            _capture = capture;
            _captureCts = new CancellationTokenSource();
            _captureTask = Task.Run(
                () => CaptureLoopAsync(capture, options, _captureCts.Token),
                CancellationToken.None
            );
            IsRunning = true;
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

        Task? captureTask = null;
        VideoCapture? capture = null;
        CancellationTokenSource? captureCts = null;

        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (!IsRunning)
            {
                return;
            }

            IsRunning = false;

            captureTask = _captureTask;
            capture = _capture;
            captureCts = _captureCts;

            _captureTask = null;
            _capture = null;
            _captureCts = null;
        }
        finally
        {
            _stateGate.Release();
        }

        try
        {
            captureCts?.Cancel();
            if (captureTask is not null)
            {
                await captureTask;
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on stop.
        }
        finally
        {
            captureCts?.Dispose();
            capture?.Dispose();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        try
        {
            await StopAsync();
        }
        finally
        {
            _stateGate.Dispose();
        }
    }

    private async Task CaptureLoopAsync(
        VideoCapture capture,
        CameraPipelineOptions options,
        CancellationToken cancellationToken
    )
    {
        var fps = Math.Max(1f, options.UploadFps);
        var frameInterval = TimeSpan.FromMilliseconds(1000.0 / fps);
        var jpegParams = new[] { new ImageEncodingParam(ImwriteFlags.JpegQuality, 72) };

        using var mat = new Mat();
        while (!cancellationToken.IsCancellationRequested)
        {
            var startedAt = DateTimeOffset.UtcNow;

            var ok = capture.Read(mat);
            if (!ok || mat.Empty())
            {
                await Task.Delay(TimeSpan.FromMilliseconds(30), cancellationToken);
                continue;
            }

            Cv2.ImEncode(".jpg", mat, out var jpegBytes, jpegParams);
            if (jpegBytes.Length > 0)
            {
                var frame = new CameraFrame(
                    jpegBytes,
                    mat.Width,
                    mat.Height,
                    fps,
                    DateTimeOffset.UtcNow
                );
                FrameReady?.Invoke(frame);
            }

            var elapsed = DateTimeOffset.UtcNow - startedAt;
            var remaining = frameInterval - elapsed;
            if (remaining > TimeSpan.Zero)
            {
                await Task.Delay(remaining, cancellationToken);
            }
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(OpenCvCameraFrameSource));
        }
    }
}
