using Aski.NativeClient.AppShell;
using Aski.NativeClient.Settings;

namespace Aski.NativeClient.Host;

public sealed class MainForm : Form
{
    private readonly Label _titleLabel;
    private readonly Label _subtitleLabel;
    private readonly TextBox _detailsBox;
    private readonly Button _reloadButton;
    private readonly NativeClientBootstrap _bootstrap;

    public MainForm()
    {
        Text = "ASKI Flow Native Host";
        Width = 960;
        Height = 620;
        MinimumSize = new Size(820, 540);
        StartPosition = FormStartPosition.CenterScreen;

        _bootstrap = new NativeClientBootstrap();

        _titleLabel = new Label
        {
            Text = "ASKI Flow Native Host",
            AutoSize = true,
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            Location = new Point(24, 20)
        };

        _subtitleLabel = new Label
        {
            Text = "Stage 12 host shell. WebView wiring can be attached here.",
            AutoSize = true,
            Font = new Font("Segoe UI", 10, FontStyle.Regular),
            ForeColor = Color.FromArgb(70, 70, 70),
            Location = new Point(28, 62)
        };

        _detailsBox = new TextBox
        {
            Multiline = true,
            ScrollBars = ScrollBars.Vertical,
            ReadOnly = true,
            Font = new Font("Consolas", 10, FontStyle.Regular),
            Location = new Point(28, 98),
            Width = ClientSize.Width - 56,
            Height = ClientSize.Height - 158,
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
        };

        _reloadButton = new Button
        {
            Text = "Reload Runtime Config",
            Width = 190,
            Height = 34,
            Location = new Point(28, ClientSize.Height - 50),
            Anchor = AnchorStyles.Left | AnchorStyles.Bottom
        };
        _reloadButton.Click += async (_, _) => await LoadRuntimeSummaryAsync();

        Controls.Add(_titleLabel);
        Controls.Add(_subtitleLabel);
        Controls.Add(_detailsBox);
        Controls.Add(_reloadButton);

        Shown += async (_, _) => await LoadRuntimeSummaryAsync();
    }

    private async Task LoadRuntimeSummaryAsync()
    {
        try
        {
            var runtime = await _bootstrap.StartAsync();
            var settings = runtime.Settings.Normalize();

            var lines = new List<string>
            {
                $"Timestamp UTC: {DateTimeOffset.UtcNow:O}",
                $"ServerHost: {settings.ServerHost}",
                $"ServerPort: {settings.ServerPort}",
                $"UseHttps: {settings.UseHttps}",
                $"ApiVersion: {settings.ApiVersion}",
                $"ClientId: {settings.ClientId}",
                $"AuthTokenSet: {!string.IsNullOrWhiteSpace(settings.AuthToken)}",
                $"RestBaseUrl: {settings.BuildServerUri(includeApiVersion: false)}",
                $"SocketUrl: {settings.BuildSocketUrl()}",
                "",
                "This host currently confirms runtime wiring for:",
                "- Settings store",
                "- REST client bootstrap",
                "- Socket client bootstrap",
                "",
                "Next integration point:",
                "- attach FlowEditorHostRuntime to a WinUI/WebView shell for hybrid editor rendering."
            };

            _detailsBox.Text = string.Join(Environment.NewLine, lines);
        }
        catch (Exception ex)
        {
            _detailsBox.Text =
                "Failed to load runtime configuration." + Environment.NewLine + ex;
        }
    }
}
