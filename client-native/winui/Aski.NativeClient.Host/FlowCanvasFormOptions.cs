namespace Aski.NativeClient.Host;

public sealed record FlowCanvasFormOptions
{
    public bool CanvasOnly { get; init; }
    public bool ShowSourceControls { get; init; } = true;
    public bool ShowStatusBar { get; init; } = true;
    public bool AutoLoadOnShown { get; init; } = true;
    public bool StartMaximized { get; init; }
}
