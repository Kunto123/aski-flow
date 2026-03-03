using System.Text.Json;

namespace Aski.NativeClient.Settings;

public sealed class JsonClientSettingsStore : IClientSettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly string _settingsFilePath;
    private readonly ISecretProtector _secretProtector;

    public JsonClientSettingsStore(
        string? settingsFilePath = null,
        ISecretProtector? secretProtector = null
    )
    {
        _settingsFilePath = settingsFilePath ?? GetDefaultSettingsFilePath();
        _secretProtector = secretProtector ?? CreateDefaultProtector();
    }

    public async Task<NativeClientSettings> LoadAsync(
        CancellationToken cancellationToken = default
    )
    {
        if (!File.Exists(_settingsFilePath))
        {
            return NativeClientSettings.Default.Normalize();
        }

        await using var stream = File.OpenRead(_settingsFilePath);
        var persisted = await JsonSerializer.DeserializeAsync<PersistedSettings>(
            stream,
            JsonOptions,
            cancellationToken
        );

        if (persisted is null)
        {
            return NativeClientSettings.Default.Normalize();
        }

        var authToken = string.Empty;
        if (!string.IsNullOrWhiteSpace(persisted.AuthTokenProtected))
        {
            authToken = _secretProtector.Unprotect(persisted.AuthTokenProtected);
        }

        return new NativeClientSettings
        {
            ServerHost = persisted.ServerHost ?? "127.0.0.1",
            ServerPort = persisted.ServerPort ?? 8000,
            UseHttps = persisted.UseHttps ?? false,
            ApiVersion = persisted.ApiVersion ?? "v1",
            ClientId = persisted.ClientId ?? string.Empty,
            AuthToken = string.IsNullOrWhiteSpace(authToken) ? null : authToken,
            RequestTimeoutSeconds = persisted.RequestTimeoutSeconds ?? 30
        }.Normalize();
    }

    public async Task SaveAsync(
        NativeClientSettings settings,
        CancellationToken cancellationToken = default
    )
    {
        var normalized = settings.Normalize();
        var directory = Path.GetDirectoryName(_settingsFilePath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var persisted = new PersistedSettings
        {
            ServerHost = normalized.ServerHost,
            ServerPort = normalized.ServerPort,
            UseHttps = normalized.UseHttps,
            ApiVersion = normalized.ApiVersion,
            ClientId = normalized.ClientId,
            RequestTimeoutSeconds = normalized.RequestTimeoutSeconds,
            AuthTokenProtected = string.IsNullOrWhiteSpace(normalized.AuthToken)
                ? null
                : _secretProtector.Protect(normalized.AuthToken)
        };

        var tempFilePath = _settingsFilePath + ".tmp";
        await using (var stream = File.Create(tempFilePath))
        {
            await JsonSerializer.SerializeAsync(
                stream,
                persisted,
                JsonOptions,
                cancellationToken
            );
        }

        File.Copy(tempFilePath, _settingsFilePath, overwrite: true);
        File.Delete(tempFilePath);
    }

    public static string GetDefaultSettingsFilePath()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appFolder = Path.Combine(localAppData, "AskiFlowNative");
        return Path.Combine(appFolder, "settings.json");
    }

    private static ISecretProtector CreateDefaultProtector()
    {
        if (OperatingSystem.IsWindows())
        {
            return new WindowsDpapiSecretProtector();
        }

        // Kept for development fallback on non-Windows environments.
        return new PlainTextSecretProtector();
    }

    private sealed class PersistedSettings
    {
        public string? ServerHost { get; init; }
        public int? ServerPort { get; init; }
        public bool? UseHttps { get; init; }
        public string? ApiVersion { get; init; }
        public string? ClientId { get; init; }
        public int? RequestTimeoutSeconds { get; init; }
        public string? AuthTokenProtected { get; init; }
    }
}
