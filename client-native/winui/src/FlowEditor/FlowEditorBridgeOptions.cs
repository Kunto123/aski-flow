namespace Aski.NativeClient.FlowEditor;

public sealed record FlowEditorBridgeOptions
{
    public FlowEditorMode Mode { get; init; } = FlowEditorMode.HybridWebView;
    public string? EditorUrl { get; init; }
    public string? EmbeddedBundleRootPath { get; init; }
    public string EmbeddedEntryFile { get; init; } = "index.html";
    public bool PreferEmbeddedBundle { get; init; } = true;
}
