using System.Text.Json;

namespace Aski.NativeClient.StreamViewer;

public sealed record NodeOutputState(
    string NodeName,
    bool IsRunning,
    IReadOnlyList<NativeOutputItem> Items,
    string? MjpegUrl = null,
    string? PredictionsUrl = null,
    JsonElement? PredictionsSnapshot = null,
    string? Error = null,
    DateTimeOffset? UpdatedAtUtc = null
)
{
    public DateTimeOffset UpdatedAtUtcOrNow => UpdatedAtUtc ?? DateTimeOffset.UtcNow;
}
