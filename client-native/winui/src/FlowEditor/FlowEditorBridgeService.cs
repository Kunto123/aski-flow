using System.Text.Json;
using Aski.NativeClient.Settings;

namespace Aski.NativeClient.FlowEditor;

public sealed class FlowEditorBridgeService
{
    private readonly NativeClientSettings _settings;
    private readonly FlowEditorBridgeOptions _options;

    public FlowEditorBridgeService(
        NativeClientSettings settings,
        FlowEditorBridgeOptions? options = null
    )
    {
        _settings = settings.Normalize();
        _options = options ?? new FlowEditorBridgeOptions();
    }

    public FlowEditorMode Mode => _options.Mode;
    public bool PreferEmbeddedBundle => _options.PreferEmbeddedBundle;

    public Uri ResolveEditorUri()
    {
        if (_options.Mode == FlowEditorMode.NativeOnly)
        {
            throw new InvalidOperationException(
                "NativeOnly mode does not use a web editor URI."
            );
        }

        if (!string.IsNullOrWhiteSpace(_options.EditorUrl))
        {
            return new Uri(_options.EditorUrl, UriKind.Absolute);
        }

        if (_options.PreferEmbeddedBundle && TryGetEmbeddedEntryUri(out var embeddedUri))
        {
            return embeddedUri;
        }

        // Fallback to backend static root hosting.
        return _settings.BuildServerUri(includeApiVersion: false);
    }

    public IReadOnlyDictionary<string, string> BuildRuntimeConfig()
    {
        var protocol = _settings.UseHttps ? "https" : "http";
        return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["serverHost"] = _settings.ServerHost,
            ["serverPort"] = _settings.ServerPort.ToString(),
            ["useHttps"] = _settings.UseHttps ? "true" : "false",
            ["apiVersion"] = _settings.ApiVersion,
            ["clientId"] = _settings.ClientId,
            ["authToken"] = _settings.AuthToken ?? string.Empty,
            ["protocol"] = protocol
        };
    }

    public string BuildJavaScriptBootstrapSnippet()
    {
        var config = BuildRuntimeConfig();
        var json = JsonSerializer.Serialize(config);

        // Mimics existing desktop preload bridge shape used by the current web UI.
        return
            "window.askiDesktop = Object.assign({}, window.askiDesktop || {}, "
            + "{ isDesktop: true, "
            + "serverHost: " + JsonSerializer.Serialize(config["serverHost"]) + ", "
            + "serverPort: " + JsonSerializer.Serialize(config["serverPort"]) + ", "
            + "useHttps: " + JsonSerializer.Serialize(config["useHttps"]) + ", "
            + "clientId: " + JsonSerializer.Serialize(config["clientId"]) + ", "
            + "authToken: " + JsonSerializer.Serialize(config["authToken"]) + ", "
            + "apiVersion: " + JsonSerializer.Serialize(config["apiVersion"]) + " });"
            + "window.__ASKI_NATIVE_RUNTIME__ = " + json + ";";
    }

    public bool TryGetEmbeddedBundleLocation(out string bundleRootPath, out string entryFile)
    {
        bundleRootPath = string.Empty;
        entryFile = string.IsNullOrWhiteSpace(_options.EmbeddedEntryFile)
            ? "index.html"
            : _options.EmbeddedEntryFile.Trim();

        if (string.IsNullOrWhiteSpace(_options.EmbeddedBundleRootPath))
        {
            return false;
        }

        var candidateRoot = _options.EmbeddedBundleRootPath.Trim();
        var candidateEntry = Path.Combine(candidateRoot, entryFile);
        if (!Directory.Exists(candidateRoot) || !File.Exists(candidateEntry))
        {
            return false;
        }

        bundleRootPath = candidateRoot;
        return true;
    }

    private bool TryGetEmbeddedEntryUri(out Uri uri)
    {
        uri = default!;
        if (!TryGetEmbeddedBundleLocation(out var rootPath, out var entryFile))
        {
            return false;
        }

        var candidate = Path.Combine(rootPath, entryFile);
        uri = new Uri(candidate, UriKind.Absolute);
        return true;
    }
}
