namespace Aski.NativeClient.CameraService;

public sealed record CameraPipelineOptions
{
    public int CameraIndex { get; init; } = 0;
    public int Width { get; init; } = 0;
    public int Height { get; init; } = 0;
    public float UploadFps { get; init; } = 0;
    public int MaxUploadInFlight { get; init; } = 1;
}
