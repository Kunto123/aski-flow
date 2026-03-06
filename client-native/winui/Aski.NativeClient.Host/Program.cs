using Aski.NativeClient.Settings;

namespace Aski.NativeClient.Host;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var startupOptions = NativeHostStartupOptions.Parse(args);

        if (startupOptions.CanvasOnly)
        {
            var settingsStore = new JsonClientSettingsStore();
            var loadedSettings = settingsStore.LoadAsync().GetAwaiter().GetResult().Normalize();
            var mergedSettings = ApplyStartupOverrides(loadedSettings, startupOptions);
            if (startupOptions.HasSettingsOverride)
            {
                settingsStore.SaveAsync(mergedSettings).GetAwaiter().GetResult();
            }

            Application.Run(
                new FlowCanvasForm(
                    settingsStore,
                    mergedSettings,
                    new FlowCanvasFormOptions
                    {
                        CanvasOnly = true,
                        ShowSourceControls = false,
                        ShowStatusBar = false,
                        AutoLoadOnShown = true,
                        StartMaximized = true
                    }
                )
            );
            return;
        }

        Application.Run(new MainForm(startupOptions));
    }

    private static NativeClientSettings ApplyStartupOverrides(
        NativeClientSettings source,
        NativeHostStartupOptions options
    )
    {
        var updated = source with
        {
            ServerHost = options.ServerAddress ?? source.ServerHost,
            ServerPort = options.ServerPort ?? source.ServerPort,
            UseHttps = options.UseHttps ?? source.UseHttps,
            ApiVersion = options.ApiVersion ?? source.ApiVersion,
            ClientId = options.ClientId ?? source.ClientId,
            AuthToken = options.AuthToken ?? source.AuthToken,
            EditorUrl = options.EditorUrl ?? source.EditorUrl,
            EditorBundleRootPath = options.EditorBundleRootPath ?? source.EditorBundleRootPath,
            EditorEntryFile = options.EditorEntryFile ?? source.EditorEntryFile
        };
        return updated.Normalize();
    }
}
