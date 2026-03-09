using Aski.NativeClient.AppShell;
using Aski.NativeClient.FlowRunner;
using Aski.NativeClient.Settings;
using Aski.NativeClient.SocketService;
using System.Net.Http.Headers;
using System.Text.Json;

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
    private readonly Button _openCanvasButton;
    private readonly Button _reloadButton;
    private readonly TextBox _flowJsonPathTextBox;
    private readonly Button _browseFlowJsonButton;
    private readonly TextBox _nodeNameTextBox;
    private readonly Button _runNodeButton;
    private readonly Button _runFlowButton;
    private readonly NativeClientBootstrap _bootstrap;
    private readonly NativeHostStartupOptions _startupOptions;
    private NativeClientRuntime? _runtime;
    private bool _startupApplied;
    private string? _editorUrlOverride;
    private string? _editorBundleRootOverride;
    private string? _editorEntryFileOverride;
    private bool _busy;

    public MainForm(NativeHostStartupOptions? startupOptions = null)
    {
        Text = "ASKI Flow Native Host";
        Width = 1060;
        Height = 720;
        MinimumSize = new Size(900, 620);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;

        var rootSplit = new SplitContainer
        {
            Dock = DockStyle.Fill,
            Orientation = Orientation.Horizontal,
            FixedPanel = FixedPanel.Panel1,
            IsSplitterFixed = false,
            SplitterDistance = 470,
            SplitterWidth = 8,
            Panel1MinSize = 360,
            Panel2MinSize = 140
        };
        rootSplit.Panel1.AutoScroll = true;
        rootSplit.Panel2.Padding = new Padding(20, 8, 20, 16);

        _bootstrap = new NativeClientBootstrap();
        _startupOptions = startupOptions ?? new NativeHostStartupOptions();

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

        var actionPanel = new FlowLayoutPanel
        {
            Location = new Point(20, 220),
            Width = configGroup.Width,
            Height = 36,
            AutoScroll = true,
            WrapContents = false,
            FlowDirection = FlowDirection.LeftToRight,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
            Margin = Padding.Empty,
            Padding = Padding.Empty
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
            Margin = new Padding(0, 0, 8, 0)
        };
        _saveButton.Click += async (_, _) => await SaveSettingsAsync();

        _reloadButton = new Button
        {
            Text = "Reload",
            Width = 92,
            Height = 32,
            Margin = new Padding(0, 0, 8, 0)
        };
        _reloadButton.Click += async (_, _) => await LoadRuntimeSummaryAsync();

        _testHealthButton = new Button
        {
            Text = "Test /health",
            Width = 108,
            Height = 32,
            Margin = new Padding(0, 0, 8, 0)
        };
        _testHealthButton.Click += async (_, _) => await TestHealthAsync();

        _testApiButton = new Button
        {
            Text = "Test API v1",
            Width = 108,
            Height = 32,
            Margin = new Padding(0, 0, 8, 0)
        };
        _testApiButton.Click += async (_, _) => await TestApiAsync();

        _connectSocketButton = new Button
        {
            Text = "Connect Socket",
            Width = 120,
            Height = 32,
            Margin = new Padding(0, 0, 8, 0)
        };
        _connectSocketButton.Click += async (_, _) => await ConnectSocketAsync();

        _disconnectSocketButton = new Button
        {
            Text = "Disconnect Socket",
            Width = 132,
            Height = 32,
            Margin = new Padding(0, 0, 8, 0)
        };
        _disconnectSocketButton.Click += async (_, _) => await DisconnectSocketAsync();

        _openCanvasButton = new Button
        {
            Text = "Open Canvas",
            Width = 112,
            Height = 32
        };
        _openCanvasButton.Click += async (_, _) => await OpenCanvasWindowAsync();

        actionPanel.Controls.Add(_saveButton);
        actionPanel.Controls.Add(_reloadButton);
        actionPanel.Controls.Add(_testHealthButton);
        actionPanel.Controls.Add(_testApiButton);
        actionPanel.Controls.Add(_connectSocketButton);
        actionPanel.Controls.Add(_disconnectSocketButton);
        actionPanel.Controls.Add(_openCanvasButton);

        var runGroup = new GroupBox
        {
            Text = "Flow Execution",
            Location = new Point(20, 264),
            Width = ClientSize.Width - 40,
            Height = 150,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        var flowJsonPathLabel = new Label
        {
            Text = "Flow JSON",
            AutoSize = true,
            Location = new Point(16, 32)
        };

        _flowJsonPathTextBox = new TextBox
        {
            Location = new Point(100, 28),
            Width = runGroup.Width - 206,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        _browseFlowJsonButton = new Button
        {
            Text = "Browse",
            Width = 84,
            Height = 28,
            Location = new Point(runGroup.Width - 96, 26),
            Anchor = AnchorStyles.Top | AnchorStyles.Right
        };
        _browseFlowJsonButton.Click += (_, _) => BrowseFlowJsonFile();

        var nodeNameLabel = new Label
        {
            Text = "Node Name",
            AutoSize = true,
            Location = new Point(16, 72)
        };

        _nodeNameTextBox = new TextBox
        {
            Location = new Point(100, 68),
            Width = 258
        };

        _runNodeButton = new Button
        {
            Text = "Run Node",
            Width = 108,
            Height = 32,
            Location = new Point(380, 64)
        };
        _runNodeButton.Click += async (_, _) => await RunNodeAsync();

        _runFlowButton = new Button
        {
            Text = "Run Flow",
            Width = 108,
            Height = 32,
            Location = new Point(494, 64)
        };
        _runFlowButton.Click += async (_, _) => await RunFlowAsync();

        var runHintLabel = new Label
        {
            Text = "Use a valid exported flow JSON. Run Node requires exact node name from the flow graph.",
            AutoSize = false,
            Width = runGroup.Width - 32,
            Height = 30,
            Location = new Point(16, 112),
            ForeColor = Color.FromArgb(96, 96, 96),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        runGroup.Controls.Add(flowJsonPathLabel);
        runGroup.Controls.Add(_flowJsonPathTextBox);
        runGroup.Controls.Add(_browseFlowJsonButton);
        runGroup.Controls.Add(nodeNameLabel);
        runGroup.Controls.Add(_nodeNameTextBox);
        runGroup.Controls.Add(_runNodeButton);
        runGroup.Controls.Add(_runFlowButton);
        runGroup.Controls.Add(runHintLabel);

        _statusLabel = new Label
        {
            Text = "Status: not initialized",
            AutoSize = true,
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            ForeColor = Color.FromArgb(24, 88, 150),
            Location = new Point(20, 424)
        };

        _logBox = new TextBox
        {
            Multiline = true,
            ScrollBars = ScrollBars.Both,
            ReadOnly = true,
            Font = new Font("Consolas", 10, FontStyle.Regular),
            Dock = DockStyle.Fill,
            WordWrap = false
        };

        rootSplit.Panel1.Controls.Add(_titleLabel);
        rootSplit.Panel1.Controls.Add(configGroup);
        rootSplit.Panel1.Controls.Add(actionPanel);
        rootSplit.Panel1.Controls.Add(runGroup);
        rootSplit.Panel1.Controls.Add(_statusLabel);
        rootSplit.Panel2.Controls.Add(_logBox);
        Controls.Add(rootSplit);

        Shown += async (_, _) => await HandleInitialShownAsync();
    }

    private async Task HandleInitialShownAsync()
    {
        await LoadRuntimeSummaryAsync();
        await ApplyStartupOptionsIfNeededAsync();
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

    private async Task ApplyStartupOptionsIfNeededAsync()
    {
        if (_startupApplied || !_startupOptions.HasAnyOverride)
        {
            return;
        }

        _startupApplied = true;
        await RunActionAsync(
            "Apply startup args",
            async () =>
            {
                if (!string.IsNullOrWhiteSpace(_startupOptions.ServerAddress))
                {
                    _serverHostTextBox.Text = _startupOptions.ServerAddress;
                }

                if (_startupOptions.ServerPort.HasValue)
                {
                    var port = _startupOptions.ServerPort.Value;
                    if (port is >= 1 and <= 65535)
                    {
                        _serverPortInput.Value = port;
                    }
                }

                if (_startupOptions.UseHttps.HasValue)
                {
                    _useHttpsCheckBox.Checked = _startupOptions.UseHttps.Value;
                }

                if (!string.IsNullOrWhiteSpace(_startupOptions.ApiVersion))
                {
                    _apiVersionTextBox.Text = _startupOptions.ApiVersion;
                }

                if (!string.IsNullOrWhiteSpace(_startupOptions.ClientId))
                {
                    _clientIdTextBox.Text = _startupOptions.ClientId;
                }

                if (!string.IsNullOrWhiteSpace(_startupOptions.AuthToken))
                {
                    _authTokenTextBox.Text = _startupOptions.AuthToken;
                }

                _editorUrlOverride = NormalizeOptional(_startupOptions.EditorUrl);
                _editorBundleRootOverride = NormalizeOptional(_startupOptions.EditorBundleRootPath);
                _editorEntryFileOverride = NormalizeOptional(_startupOptions.EditorEntryFile);

                await SaveSettingsCoreAsync();
                AppendLog("Startup args applied.");

                _editorUrlOverride = null;
                _editorBundleRootOverride = null;
                _editorEntryFileOverride = null;

                if (_startupOptions.AutoOpenCanvas)
                {
                    await OpenCanvasWindowCoreAsync();
                }
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

    private async Task OpenCanvasWindowAsync()
    {
        await RunActionAsync(
            "Open canvas window",
            OpenCanvasWindowCoreAsync
        );
    }

    private async Task OpenCanvasWindowCoreAsync()
    {
        await SaveSettingsCoreAsync();
        if (_runtime is null)
        {
            throw new InvalidOperationException("Runtime is not available.");
        }

        var canvasForm = new FlowCanvasForm(
            _runtime.SettingsStore,
            ReadSettingsFromForm()
        );
        canvasForm.Show(this);
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

    private async Task RunNodeAsync()
    {
        await RunActionAsync(
            "Run node",
            async () =>
            {
                var nodeName = _nodeNameTextBox.Text?.Trim();
                if (string.IsNullOrWhiteSpace(nodeName))
                {
                    throw new InvalidOperationException("Node Name is required.");
                }

                var flowJson = await ReadFlowJsonAsync();
                await EnsureSocketReadyAsync();
                await _runtime!.SocketClient.EmitRunNodeAsync(
                    new RunNodeRequest(flowJson, nodeName)
                );
                AppendLog($"run_node emitted. NodeName={nodeName}");
            }
        );
    }

    private async Task RunFlowAsync()
    {
        await RunActionAsync(
            "Run flow",
            async () =>
            {
                var flowJson = await ReadFlowJsonAsync();
                await EnsureSocketReadyAsync();
                await _runtime!.SocketClient.EmitProcessFileAsync(new ProcessFileRequest(flowJson));
                AppendLog("process_file emitted.");
            }
        );
    }

    private async Task EnsureSocketReadyAsync()
    {
        await SaveSettingsCoreAsync();
        if (_runtime is null)
        {
            throw new InvalidOperationException("Runtime is not available.");
        }

        if (!_runtime.SocketClient.IsConnected)
        {
            await _runtime.SocketClient.ConnectAsync();
            AppendLog("Socket connected for flow execution.");
        }

        UpdateSocketStatus();
    }

    private async Task<string> ReadFlowJsonAsync()
    {
        var path = _flowJsonPathTextBox.Text?.Trim();
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new InvalidOperationException("Flow JSON file path is required.");
        }

        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Flow JSON file not found: {path}");
        }

        var content = await File.ReadAllTextAsync(path);
        using var _ = JsonDocument.Parse(content);
        return content;
    }

    private void BrowseFlowJsonFile()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
            Title = "Select flow JSON file",
            CheckFileExists = true
        };

        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _flowJsonPathTextBox.Text = dialog.FileName;
        }
    }

    private NativeClientSettings ReadSettingsFromForm()
    {
        var existing = _runtime?.Settings.Normalize();
        var token = _authTokenTextBox.Text?.Trim();
        return new NativeClientSettings
        {
            ServerHost = _serverHostTextBox.Text,
            ServerPort = (int)_serverPortInput.Value,
            UseHttps = _useHttpsCheckBox.Checked,
            ApiVersion = _apiVersionTextBox.Text,
            ClientId = _clientIdTextBox.Text,
            AuthToken = string.IsNullOrWhiteSpace(token) ? null : token,
            EditorUrl = _editorUrlOverride ?? existing?.EditorUrl,
            EditorBundleRootPath = _editorBundleRootOverride ?? existing?.EditorBundleRootPath,
            EditorEntryFile = _editorEntryFileOverride ?? existing?.EditorEntryFile ?? "index.html",
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
        socketClient.ProgressReceived += HandleSocketProgress;
        socketClient.CurrentNodeRunningReceived += HandleCurrentNodeRunning;
        socketClient.RunEndReceived += HandleRunEnd;
    }

    private void DetachSocketEvents(IFlowSocketClient socketClient)
    {
        socketClient.Connected -= HandleSocketConnected;
        socketClient.Disconnected -= HandleSocketDisconnected;
        socketClient.ErrorReceived -= HandleSocketError;
        socketClient.ProgressReceived -= HandleSocketProgress;
        socketClient.CurrentNodeRunningReceived -= HandleCurrentNodeRunning;
        socketClient.RunEndReceived -= HandleRunEnd;
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

    private void HandleSocketProgress(FlowProgressEvent progress)
    {
        var outputSummary = SummarizeOutput(progress.Output);
        AppendLog(
            $"Progress: instance={progress.InstanceName} done={progress.IsDone} output={outputSummary}"
        );
    }

    private void HandleCurrentNodeRunning(FlowCurrentNodeRunningEvent progress)
    {
        AppendLog($"Current node: {progress.InstanceName}");
    }

    private void HandleRunEnd(FlowRunEndEvent runEnd)
    {
        AppendLog($"Run end: output={SummarizeOutput(runEnd.Output)}");
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
        _openCanvasButton.Enabled = !_busy;
        _browseFlowJsonButton.Enabled = !_busy;
        _runNodeButton.Enabled = !_busy;
        _runFlowButton.Enabled = !_busy;
    }

    private static string SummarizeOutput(object? output)
    {
        if (output is null)
        {
            return "null";
        }

        if (output is JsonElement element)
        {
            return Truncate(element.GetRawText(), 260);
        }

        return Truncate(output.ToString() ?? output.GetType().Name, 260);
    }

    private static string Truncate(string value, int maxLength)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= maxLength)
        {
            return value;
        }

        return value[..maxLength] + "...";
    }

    private static string? NormalizeOptional(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
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
