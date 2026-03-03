namespace Aski.NativeClient.CameraService;

public sealed record CameraFrame(
    byte[] JpegBytes,
    int Width,
    int Height,
    float Fps,
    DateTimeOffset CapturedAtUtc
);
