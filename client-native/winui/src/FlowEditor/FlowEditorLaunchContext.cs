namespace Aski.NativeClient.FlowEditor;

public sealed record FlowEditorLaunchContext(
    Uri EditorUri,
    string JavaScriptBootstrap,
    IReadOnlyDictionary<string, string> RuntimeConfig,
    bool UsesLocalBundleHost
);
