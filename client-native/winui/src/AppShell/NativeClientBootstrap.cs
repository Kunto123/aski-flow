using Aski.NativeClient.FlowRunner;
using Aski.NativeClient.Settings;
using Aski.NativeClient.SocketService;

namespace Aski.NativeClient.AppShell;

public sealed class NativeClientBootstrap
{
    private readonly IClientSettingsStore _settingsStore;

    public NativeClientBootstrap(IClientSettingsStore? settingsStore = null)
    {
        _settingsStore = settingsStore ?? new JsonClientSettingsStore();
    }

    public async Task<NativeClientRuntime> StartAsync(
        CancellationToken cancellationToken = default
    )
    {
        var settings = await _settingsStore.LoadAsync(cancellationToken);
        var normalizedSettings = settings.Normalize();
        await _settingsStore.SaveAsync(normalizedSettings, cancellationToken);

        var restClient = new AskiRestClient(new HttpClient(), normalizedSettings);
        var socketClient = FlowSocketClientFactory.Create(normalizedSettings);

        return new NativeClientRuntime(
            normalizedSettings,
            restClient,
            socketClient,
            _settingsStore
        );
    }
}

public sealed record NativeClientRuntime(
    NativeClientSettings Settings,
    AskiRestClient RestClient,
    IFlowSocketClient SocketClient,
    IClientSettingsStore SettingsStore
);
