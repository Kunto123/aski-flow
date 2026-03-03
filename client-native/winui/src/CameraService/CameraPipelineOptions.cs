namespace Aski.NativeClient.CameraService;

public sealed record CameraPipelineOptions
{
    public int CameraIndex { get; init; } = 0;
    public int Width { get; init; } = 640;
    public int Height { get; init; } = 360;
    public float UploadFps { get; init; } = 12;
    public int MaxUploadInFlight { get; init; } = 1;
}
