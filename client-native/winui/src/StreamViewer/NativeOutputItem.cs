using System.Text.Json;

namespace Aski.NativeClient.StreamViewer;

public sealed record NativeOutputItem(
    NativeOutputKind Kind,
    string? Text = null,
    string? Url = null,
    string? StreamId = null,
    JsonElement? Json = null
);
