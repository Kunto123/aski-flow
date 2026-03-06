namespace Aski.NativeClient.Host;

public sealed record NativeHostStartupOptions
{
    public string? ServerAddress { get; init; }
    public int? ServerPort { get; init; }
    public bool? UseHttps { get; init; }
    public string? ApiVersion { get; init; }
    public string? ClientId { get; init; }
    public string? AuthToken { get; init; }
    public string? EditorUrl { get; init; }
    public string? EditorBundleRootPath { get; init; }
    public string? EditorEntryFile { get; init; }
    public bool AutoOpenCanvas { get; init; }
    public bool CanvasOnly { get; init; }

    public bool HasSettingsOverride =>
        !string.IsNullOrWhiteSpace(ServerAddress)
        || ServerPort.HasValue
        || UseHttps.HasValue
        || !string.IsNullOrWhiteSpace(ApiVersion)
        || !string.IsNullOrWhiteSpace(ClientId)
        || !string.IsNullOrWhiteSpace(AuthToken)
        || !string.IsNullOrWhiteSpace(EditorUrl)
        || !string.IsNullOrWhiteSpace(EditorBundleRootPath)
        || !string.IsNullOrWhiteSpace(EditorEntryFile);

    public bool HasAnyOverride =>
        HasSettingsOverride
        || AutoOpenCanvas
        || CanvasOnly;

    public static NativeHostStartupOptions Parse(string[]? args)
    {
        if (args is null || args.Length == 0)
        {
            return new NativeHostStartupOptions();
        }

        string? serverAddress = null;
        int? serverPort = null;
        bool? useHttps = null;
        string? apiVersion = null;
        string? clientId = null;
        string? authToken = null;
        string? editorUrl = null;
        string? editorBundleRootPath = null;
        string? editorEntryFile = null;
        var autoOpenCanvas = false;
        var canvasOnly = false;

        for (var i = 0; i < args.Length; i++)
        {
            var raw = args[i];
            if (string.IsNullOrWhiteSpace(raw) || !raw.StartsWith('-'))
            {
                continue;
            }

            var key = NormalizeKey(raw, out var inlineValue);
            var value = inlineValue ?? TryReadFollowingValue(args, ref i);

            switch (key)
            {
                case "serveraddress":
                case "serverhost":
                    serverAddress = Normalize(value);
                    break;
                case "serverport":
                    if (int.TryParse(value, out var parsedPort))
                    {
                        serverPort = parsedPort;
                    }
                    break;
                case "usehttps":
                    useHttps = value is null ? true : ParseBool(value);
                    break;
                case "apiversion":
                    apiVersion = Normalize(value);
                    break;
                case "clientid":
                    clientId = Normalize(value);
                    break;
                case "authtoken":
                    authToken = Normalize(value);
                    break;
                case "editorurl":
                    editorUrl = Normalize(value);
                    break;
                case "editorbundleroot":
                case "editorbundle":
                case "editorbundlerootpath":
                    editorBundleRootPath = Normalize(value);
                    break;
                case "editorentry":
                case "editorentryfile":
                    editorEntryFile = Normalize(value);
                    break;
                case "opencanvas":
                case "autoopencanvas":
                    autoOpenCanvas = value is null || ParseBool(value);
                    break;
                case "noautoopencanvas":
                    autoOpenCanvas = false;
                    break;
                case "canvasonly":
                case "canvas":
                case "kiosk":
                    canvasOnly = value is null || ParseBool(value);
                    break;
                case "nocanvasonly":
                    canvasOnly = false;
                    break;
            }
        }

        return new NativeHostStartupOptions
        {
            ServerAddress = serverAddress,
            ServerPort = serverPort,
            UseHttps = useHttps,
            ApiVersion = apiVersion,
            ClientId = clientId,
            AuthToken = authToken,
            EditorUrl = editorUrl,
            EditorBundleRootPath = editorBundleRootPath,
            EditorEntryFile = editorEntryFile,
            AutoOpenCanvas = autoOpenCanvas,
            CanvasOnly = canvasOnly
        };
    }

    private static string NormalizeKey(string rawKey, out string? inlineValue)
    {
        inlineValue = null;
        var trimmed = rawKey.TrimStart('-').Trim();
        var equalIndex = trimmed.IndexOf('=');
        if (equalIndex <= 0)
        {
            return trimmed.ToLowerInvariant();
        }

        inlineValue = trimmed[(equalIndex + 1)..].Trim();
        return trimmed[..equalIndex].Trim().ToLowerInvariant();
    }

    private static string? TryReadFollowingValue(string[] args, ref int index)
    {
        var nextIndex = index + 1;
        if (nextIndex >= args.Length)
        {
            return null;
        }

        var candidate = args[nextIndex];
        if (string.IsNullOrWhiteSpace(candidate) || candidate.StartsWith('-'))
        {
            return null;
        }

        index = nextIndex;
        return candidate.Trim();
    }

    private static string? Normalize(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    private static bool ParseBool(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return value.Trim().ToLowerInvariant() switch
        {
            "1" => true,
            "true" => true,
            "yes" => true,
            "y" => true,
            "on" => true,
            _ => false
        };
    }
}
