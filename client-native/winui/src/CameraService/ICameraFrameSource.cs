namespace Aski.NativeClient.CameraService;

public interface ICameraFrameSource : IAsyncDisposable
{
    bool IsRunning { get; }
    event Action<CameraFrame>? FrameReady;

    Task StartAsync(CameraPipelineOptions options, CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
}
