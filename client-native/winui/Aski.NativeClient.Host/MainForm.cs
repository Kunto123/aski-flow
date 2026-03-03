using Aski.NativeClient.AppShell;
using Aski.NativeClient.FlowRunner;
using Aski.NativeClient.Settings;
using Aski.NativeClient.SocketService;
using System.Net.Http.Headers;

namespace Aski.NativeClient.Host;

public sealed class MainForm : Form
{
    private readonly Label _titleLabel;
    private readonly Label _statusLabel;
    private readonly TextBox _serverHostTextBox;
    private readonly NumericUpDown _serverPortInput;
    private readonly CheckBox _useHttpsCheckBox;
    private readonly TextBox _apiVersionTextBox;
    private readonly TextBox _clientIdTextBox;
    private readonly TextBox _authTokenTextBox;
    private readonly TextBox _logBox;
    private readonly Button _saveButton;
    private readonly Button _testHealthButton;
    private readonly Button _testApiButton;
    private readonly Button _connectSocketButton;
    private readonly Button _disconnectSocketButton;
    private readonly Button _reloadButton;
    private readonly NativeClientBootstrap _bootstrap;
    private NativeClientRuntime? _runtime;
    private bool _busy;

    public MainForm()
    {
        Text = "ASKI Flow Native Host";
        Width = 1060;
        Height = 720;
        MinimumSize = new Size(900, 620);
        StartPosition = FormStartPosition.CenterScreen;

        _bootstrap = new NativeClientBootstrap();

        _titleLabel = new Label
        {
            Text = "ASKI Flow Native Client",
            AutoSize = true,
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            Location = new Point(20, 16)
        };

        var configGroup = new GroupBox
        {
            Text = "Connection Settings",
            Location = new Point(20, 56),
            Width = ClientSize.Width - 40,
            Height = 150,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        var hostLabel = new Label
        {
            Text = "Server Host",
            AutoSize = true,
            Location = new Point(16, 30)
        };

        _serverHostTextBox = new TextBox
        {
            Location = new Point(100, 26),
            Width = 190
        };

        var portLabel = new Label
        {
            Text = "Port",
            AutoSize = true,
            Location = new Point(308, 30)
        };

        _serverPortInput = new NumericUpDown
        {
            Location = new Point(344, 26),
            Width = 82,
            Minimum = 1,
            Maximum = 65535,
            Value = 8000
        };

        _useHttpsCheckBox = new CheckBox
        {
            Text = "Use HTTPS",
            AutoSize = true,
            Location = new Point(446, 28)
        };

        var apiVersionLabel = new Label
        {
            Text = "API Version",
            AutoSize = true,
            Location = new Point(16, 64)
        };

        _apiVersionTextBox = new TextBox
        {
            Location = new Point(100, 60),
            Width = 100
        };

        var clientIdLabel = new Label
        {
            Text = "Client ID",
            AutoSize = true,
            Location = new Point(220, 64)
        };

        _clientIdTextBox = new TextBox
        {
            Location = new Point(278, 60),
            Width = 250
        };

        var authTokenLabel = new Label
        {
            Text = "Auth Token",
            AutoSize = true,
            Location = new Point(16, 98)
        };

        _authTokenTextBox = new TextBox
        {
            Location = new Point(100, 94),
            Width = 428,
            UseSystemPasswordChar = true
        };

        configGroup.Controls.Add(hostLabel);
        configGroup.Controls.Add(_serverHostTextBox);
        configGroup.Controls.Add(portLabel);
        configGroup.Controls.Add(_serverPortInput);
        configGroup.Controls.Add(_useHttpsCheckBox);
        configGroup.Controls.Add(apiVersionLabel);
        configGroup.Controls.Add(_apiVersionTextBox);
        configGroup.Controls.Add(clientIdLabel);
        configGroup.Controls.Add(_clientIdTextBox);
        configGroup.Controls.Add(authTokenLabel);
        configGroup.Controls.Add(_authTokenTextBox);

        _saveButton = new Button
        {
            Text = "Save Settings",
            Width = 112,
            Height = 32,
            Location = new Point(20, 220),
            Anchor = AnchorStyles.Left | AnchorStyles.Top
        };
        _saveButton.Click += async (_, _) => await SaveSettingsAsync();

        _reloadButton = new Button
        {
            Text = "Reload",
            Width = 92,
            Height = 32,
            Location = new Point(138, 220),
            Anchor = AnchorStyles.Left | AnchorStyles.Top
        };
        _reloadButton.Click += async (_, _) => await LoadRuntimeSummaryAsync();

        _testHealthButton = new Button
        {
            Text = "Test /health",
            Width = 108,
            Height = 32,
            Location = new Point(236, 220),
            Anchor = AnchorStyles.Left | AnchorStyles.Top
        };
        _testHealthButton.Click += async (_, _) => await TestHealthAsync();

        _testApiButton = new Button
        {
            Text = "Test API v1",
            Width = 108,
            Height = 32,
            Location = new Point(350, 220),
            Anchor = AnchorStyles.Left | AnchorStyles.Top
        };
        _testApiButton.Click += async (_, _) => await TestApiAsync();

        _connectSocketButton = new Button
        {
            Text = "Connect Socket",
            Width = 120,
            Height = 32,
            Location = new Point(464, 220),
            Anchor = AnchorStyles.Left | AnchorStyles.Top
        };
        _connectSocketButton.Click += async (_, _) => await ConnectSocketAsync();

        _disconnectSocketButton = new Button
        {
            Text = "Disconnect Socket",
            Width = 132,
            Height = 32,
            Location = new Point(590, 220),
            Anchor = AnchorStyles.Left | AnchorStyles.Top
        };
        _disconnectSocketButton.Click += async (_, _) => await DisconnectSocketAsync();

        _statusLabel = new Label
        {
            Text = "Status: not initialized",
            AutoSize = true,
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            ForeColor = Color.FromArgb(24, 88, 150),
            Location = new Point(20, 264)
        };

        _logBox = new TextBox
        {
            Multiline = true,
            ScrollBars = ScrollBars.Vertical,
            ReadOnly = true,
            Font = new Font("Consolas", 10, FontStyle.Regular),
            Location = new Point(20, 290),
            Width = ClientSize.Width - 40,
            Height = ClientSize.Height - 330,
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
        };

        Controls.Add(_titleLabel);
        Controls.Add(configGroup);
        Controls.Add(_saveButton);
        Controls.Add(_reloadButton);
        Controls.Add(_testHealthButton);
        Controls.Add(_testApiButton);
        Controls.Add(_connectSocketButton);
        Controls.Add(_disconnectSocketButton);
        Controls.Add(_statusLabel);
        Controls.Add(_logBox);

        Shown += async (_, _) => await LoadRuntimeSummaryAsync();
    }

    private async Task LoadRuntimeSummaryAsync()
    {
        await RunActionAsync(
            "Load runtime",
            async () =>
            {
                await ReplaceRuntimeAsync();
                AppendLog(
                    $"Runtime ready. REST={_runtime!.Settings.BuildServerUri(includeApiVersion: false)} Socket={_runtime.Settings.BuildSocketUrl()} ClientId={_runtime.Settings.ClientId}"
                );
                UpdateSocketStatus();
            }
        );
    }

    private async Task SaveSettingsAsync()
    {
        await RunActionAsync(
            "Save settings",
            async () =>
            {
                var settings = ReadSettingsFromForm();
                if (_runtime is null)
                {
                    await ReplaceRuntimeAsync();
                }

                await _runtime!.SettingsStore.SaveAsync(settings);
                AppendLog(
                    $"Settings saved. Host={settings.ServerHost} Port={settings.ServerPort} ApiVersion={settings.ApiVersion} AuthTokenSet={!string.IsNullOrWhiteSpace(settings.AuthToken)}"
                );
                await ReplaceRuntimeAsync();
                UpdateSocketStatus();
            }
        );
    }

    private async Task TestHealthAsync()
    {
        await RunActionAsync(
            "Test /health",
            async () =>
            {
                var settings = ReadSettingsFromForm();
                using var httpClient = new HttpClient
                {
                    Timeout = TimeSpan.FromSeconds(settings.RequestTimeoutSeconds)
                };
                using var request = new HttpRequestMessage(
                    HttpMethod.Get,
                    new Uri(settings.BuildServerUri(includeApiVersion: false), "health")
                );

                request.Headers.TryAddWithoutValidation("X-Aski-Client-Id", settings.ClientId);
                if (!string.IsNullOrWhiteSpace(settings.AuthToken))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue(
                        "Bearer",
                        settings.AuthToken
                    );
                    request.Headers.TryAddWithoutValidation(
                        "X-Aski-Auth-Token",
                        settings.AuthToken
                    );
                }

                using var response = await httpClient.SendAsync(request);
                var body = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    throw new InvalidOperationException(
                        $"Health check failed: {(int)response.StatusCode} {response.ReasonPhrase}. Body={body}"
                    );
                }

                AppendLog($"Health OK: {body}");
            }
        );
    }

    private async Task TestApiAsync()
    {
        await RunActionAsync(
            "Test API v1 (/node/extensions)",
            async () =>
            {
                var settings = ReadSettingsFromForm();
                using var httpClient = new HttpClient();
                var restClient = new AskiRestClient(httpClient, settings);
                using var response = await restClient.GetNodeExtensionsAsync();
                var root = response.RootElement;
                var summary = root.ValueKind == System.Text.Json.JsonValueKind.Object
                    ? string.Join(", ", root.EnumerateObject().Take(5).Select(x => x.Name))
                    : root.ValueKind.ToString();
                AppendLog($"API v1 reachable. Root={root.ValueKind}; keys={summary}");
            }
        );
    }

    private async Task ConnectSocketAsync()
    {
        await RunActionAsync(
            "Connect socket",
            async () =>
            {
                await SaveSettingsCoreAsync();
                await _runtime!.SocketClient.ConnectAsync();
                UpdateSocketStatus();
                AppendLog($"Socket connect requested. SessionId={_runtime.SocketClient.SessionId ?? "-"}");
            }
        );
    }

    private async Task DisconnectSocketAsync()
    {
        await RunActionAsync(
            "Disconnect socket",
            async () =>
            {
                if (_runtime is null)
                {
                    return;
                }

                await _runtime.SocketClient.DisconnectAsync();
                UpdateSocketStatus();
                AppendLog("Socket disconnected.");
            }
        );
    }

    private async Task SaveSettingsCoreAsync()
    {
        var settings = ReadSettingsFromForm();
        if (_runtime is null)
        {
            await ReplaceRuntimeAsync();
        }

        await _runtime!.SettingsStore.SaveAsync(settings);
        await ReplaceRuntimeAsync();
    }

    private NativeClientSettings ReadSettingsFromForm()
    {
        var token = _authTokenTextBox.Text?.Trim();
        return new NativeClientSettings
        {
            ServerHost = _serverHostTextBox.Text,
            ServerPort = (int)_serverPortInput.Value,
            UseHttps = _useHttpsCheckBox.Checked,
            ApiVersion = _apiVersionTextBox.Text,
            ClientId = _clientIdTextBox.Text,
            AuthToken = string.IsNullOrWhiteSpace(token) ? null : token,
            RequestTimeoutSeconds = 30
        }.Normalize();
    }

    private void ApplySettingsToForm(NativeClientSettings settings)
    {
        _serverHostTextBox.Text = settings.ServerHost;
        _serverPortInput.Value = settings.ServerPort;
        _useHttpsCheckBox.Checked = settings.UseHttps;
        _apiVersionTextBox.Text = settings.ApiVersion;
        _clientIdTextBox.Text = settings.ClientId;
        _authTokenTextBox.Text = settings.AuthToken ?? string.Empty;
    }

    private async Task ReplaceRuntimeAsync()
    {
        var previousRuntime = _runtime;
        if (previousRuntime is not null)
        {
            DetachSocketEvents(previousRuntime.SocketClient);
            try
            {
                await previousRuntime.SocketClient.DisposeAsync();
            }
            catch
            {
                // best effort on runtime swap
            }
        }

        _runtime = await _bootstrap.StartAsync();
        ApplySettingsToForm(_runtime.Settings.Normalize());
        AttachSocketEvents(_runtime.SocketClient);
    }

    private void AttachSocketEvents(IFlowSocketClient socketClient)
    {
        socketClient.Connected += HandleSocketConnected;
        socketClient.Disconnected += HandleSocketDisconnected;
        socketClient.ErrorReceived += HandleSocketError;
    }

    private void DetachSocketEvents(IFlowSocketClient socketClient)
    {
        socketClient.Connected -= HandleSocketConnected;
        socketClient.Disconnected -= HandleSocketDisconnected;
        socketClient.ErrorReceived -= HandleSocketError;
    }

    private void HandleSocketConnected()
    {
        AppendLog("Socket connected.");
        UpdateSocketStatus();
    }

    private void HandleSocketDisconnected(string? reason)
    {
        AppendLog($"Socket disconnected. Reason={reason ?? "-"}");
        UpdateSocketStatus();
    }

    private void HandleSocketError(FlowErrorEvent error)
    {
        AppendLog($"Socket error: {error.Error}");
        UpdateSocketStatus();
    }

    private void UpdateSocketStatus()
    {
        if (InvokeRequired)
        {
            BeginInvoke(UpdateSocketStatus);
            return;
        }

        var socketConnected = _runtime?.SocketClient.IsConnected == true;
        var status = socketConnected ? "connected" : "disconnected";
        var sessionId = _runtime?.SocketClient.SessionId ?? "-";
        var host = _runtime?.Settings.ServerHost ?? "-";
        var port = _runtime?.Settings.ServerPort ?? 0;
        _statusLabel.Text = $"Status: {status} | SessionId: {sessionId} | Target: {host}:{port}";
        UpdateButtons();
    }

    private async Task RunActionAsync(string actionName, Func<Task> action)
    {
        if (_busy)
        {
            return;
        }

        _busy = true;
        UpdateButtons();
        try
        {
            AppendLog($"{actionName} started.");
            await action();
            AppendLog($"{actionName} completed.");
        }
        catch (Exception ex)
        {
            AppendLog($"{actionName} failed: {ex.Message}");
            MessageBox.Show(
                this,
                ex.ToString(),
                "Operation failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        finally
        {
            _busy = false;
            UpdateButtons();
        }
    }

    private void AppendLog(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => AppendLog(message));
            return;
        }

        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        _logBox.AppendText(line + Environment.NewLine);
    }

    private void UpdateButtons()
    {
        var connected = _runtime?.SocketClient.IsConnected == true;
        _saveButton.Enabled = !_busy;
        _reloadButton.Enabled = !_busy;
        _testHealthButton.Enabled = !_busy;
        _testApiButton.Enabled = !_busy;
        _connectSocketButton.Enabled = !_busy && !connected;
        _disconnectSocketButton.Enabled = !_busy && connected;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        try
        {
            if (_runtime is not null)
            {
                DetachSocketEvents(_runtime.SocketClient);
                _runtime.SocketClient.DisposeAsync().AsTask().GetAwaiter().GetResult();
            }
        }
        catch
        {
            // ignore cleanup failure during app close
        }

        base.OnFormClosing(e);
    }
}
