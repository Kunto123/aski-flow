namespace Aski.NativeClient.Settings;

public interface IClientSettingsStore
{
    Task<NativeClientSettings> LoadAsync(CancellationToken cancellationToken = default);

    Task SaveAsync(
        NativeClientSettings settings,
        CancellationToken cancellationToken = default
    );
}
