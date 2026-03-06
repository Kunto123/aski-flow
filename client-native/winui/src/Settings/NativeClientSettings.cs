using System.Security.Cryptography;

namespace Aski.NativeClient.Settings;

public sealed record NativeClientSettings
{
    public string ServerHost { get; init; } = "127.0.0.1";
    public int ServerPort { get; init; } = 8000;
    public bool UseHttps { get; init; } = false;
    public string ApiVersion { get; init; } = "v1";
    public string ClientId { get; init; } = string.Empty;
    public string? AuthToken { get; init; }
    public string? EditorUrl { get; init; }
    public string? EditorBundleRootPath { get; init; }
    public string EditorEntryFile { get; init; } = "index.html";
    public int RequestTimeoutSeconds { get; init; } = 30;

    public static NativeClientSettings Default => new()
    {
        ClientId = GenerateClientId()
    };

    public NativeClientSettings Normalize()
    {
        var normalizedHost = string.IsNullOrWhiteSpace(ServerHost)
            ? "127.0.0.1"
            : ServerHost.Trim();

        var normalizedPort = ServerPort is > 0 and <= 65535 ? ServerPort : 8000;
        var normalizedApiVersion = (ApiVersion ?? string.Empty).Trim().Trim('/');
        var normalizedClientId = string.IsNullOrWhiteSpace(ClientId) || IsLegacyInvalidClientId(ClientId)
            ? GenerateClientId()
            : ClientId.Trim();
        var normalizedEditorUrl = string.IsNullOrWhiteSpace(EditorUrl) ? null : EditorUrl.Trim();
        var normalizedEditorBundleRoot = string.IsNullOrWhiteSpace(EditorBundleRootPath)
            ? null
            : EditorBundleRootPath.Trim();
        var normalizedEditorEntry = string.IsNullOrWhiteSpace(EditorEntryFile)
            ? "index.html"
            : EditorEntryFile.Trim().TrimStart('/', '\\');
        var normalizedTimeout = RequestTimeoutSeconds <= 0 ? 30 : RequestTimeoutSeconds;

        return this with
        {
            ServerHost = normalizedHost,
            ServerPort = normalizedPort,
            ApiVersion = normalizedApiVersion,
            ClientId = normalizedClientId,
            EditorUrl = normalizedEditorUrl,
            EditorBundleRootPath = normalizedEditorBundleRoot,
            EditorEntryFile = normalizedEditorEntry,
            RequestTimeoutSeconds = normalizedTimeout
        };
    }

    public Uri BuildServerUri(bool includeApiVersion = true)
    {
        var normalized = Normalize();
        var scheme = normalized.UseHttps ? "https" : "http";
        var builder = new UriBuilder(scheme, normalized.ServerHost, normalized.ServerPort);

        if (includeApiVersion && !string.IsNullOrWhiteSpace(normalized.ApiVersion))
        {
            builder.Path = normalized.ApiVersion;
        }

        return builder.Uri;
    }

    public string BuildSocketUrl()
    {
        var normalized = Normalize();
        var scheme = normalized.UseHttps ? "https" : "http";
        return $"{scheme}://{normalized.ServerHost}:{normalized.ServerPort}";
    }

    private static string GenerateClientId()
    {
        // Keep the client id short enough for logging and header transport.
        Span<byte> bytes = stackalloc byte[8];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static bool IsLegacyInvalidClientId(string? clientId)
    {
        var trimmed = (clientId ?? string.Empty).Trim();
        return string.Equals(trimmed, "0000000000000000", StringComparison.Ordinal);
    }
}
