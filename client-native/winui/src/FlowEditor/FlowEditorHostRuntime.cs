namespace Aski.NativeClient.FlowEditor;

public sealed class FlowEditorHostRuntime : IAsyncDisposable
{
    private readonly FlowEditorBridgeService _bridgeService;
    private readonly LocalBundleWebHost _localBundleHost;
    private bool _disposed;

    public FlowEditorHostRuntime(
        FlowEditorBridgeService bridgeService,
        LocalBundleWebHost? localBundleHost = null
    )
    {
        _bridgeService = bridgeService ?? throw new ArgumentNullException(nameof(bridgeService));
        _localBundleHost = localBundleHost ?? new LocalBundleWebHost();
    }

    public async Task<FlowEditorLaunchContext> CreateLaunchContextAsync(
        CancellationToken cancellationToken = default
    )
    {
        ThrowIfDisposed();

        if (_bridgeService.Mode == FlowEditorMode.NativeOnly)
        {
            throw new InvalidOperationException(
                "Flow editor is configured for NativeOnly mode."
            );
        }

        var runtimeConfig = _bridgeService.BuildRuntimeConfig();
        var bootstrapScript = _bridgeService.BuildJavaScriptBootstrapSnippet();

        if (
            _bridgeService.PreferEmbeddedBundle
            && _bridgeService.TryGetEmbeddedBundleLocation(out var bundleRoot, out var entryFile)
        )
        {
            var baseUri = await _localBundleHost.StartAsync(
                bundleRoot,
                entryFile,
                cancellationToken
            );
            var launchUri = new Uri(baseUri, entryFile);

            return new FlowEditorLaunchContext(
                launchUri,
                bootstrapScript,
                runtimeConfig,
                UsesLocalBundleHost: true
            );
        }

        var fallbackUri = _bridgeService.ResolveEditorUri();
        return new FlowEditorLaunchContext(
            fallbackUri,
            bootstrapScript,
            runtimeConfig,
            UsesLocalBundleHost: false
        );
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        await _localBundleHost.DisposeAsync();
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(FlowEditorHostRuntime));
        }
    }
}
