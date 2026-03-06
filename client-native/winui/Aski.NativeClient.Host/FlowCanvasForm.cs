using Aski.NativeClient.FlowEditor;
using Aski.NativeClient.Settings;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;

namespace Aski.NativeClient.Host;

public sealed class FlowCanvasForm : Form
{
    private readonly IClientSettingsStore _settingsStore;
    private readonly FlowCanvasFormOptions _options;
    private NativeClientSettings _settings;

    private readonly GroupBox _sourceGroup;
    private readonly TextBox _editorUrlTextBox;
    private readonly TextBox _editorBundleRootTextBox;
    private readonly TextBox _editorEntryFileTextBox;
    private readonly Button _browseBundleRootButton;
    private readonly Button _loadCanvasButton;
    private readonly Button _reloadCanvasButton;
    private readonly Button _openExternalButton;
    private readonly Label _statusLabel;
    private readonly WebView2 _webView;

    private FlowEditorHostRuntime? _flowEditorRuntime;
    private string? _bootstrapScriptId;
    private Uri? _currentUri;
    private bool _busy;

    public FlowCanvasForm(
        IClientSettingsStore settingsStore,
        NativeClientSettings initialSettings,
        FlowCanvasFormOptions? options = null
    )
    {
        _settingsStore = settingsStore ?? throw new ArgumentNullException(nameof(settingsStore));
        _options = options ?? new FlowCanvasFormOptions();
        _settings = initialSettings.Normalize();

        Text = "ASKI Flow - Canvas";
        Width = 1360;
        Height = 860;
        MinimumSize = new Size(1000, 640);
        StartPosition = FormStartPosition.CenterParent;

        _sourceGroup = new GroupBox
        {
            Text = "Canvas Source",
            Location = new Point(12, 12),
            Width = ClientSize.Width - 24,
            Height = 128,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        var editorUrlLabel = new Label
        {
            Text = "Editor URL",
            AutoSize = true,
            Location = new Point(14, 30)
        };

        _editorUrlTextBox = new TextBox
        {
            Location = new Point(100, 26),
            Width = _sourceGroup.Width - 114,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        var bundleRootLabel = new Label
        {
            Text = "Bundle Root",
            AutoSize = true,
            Location = new Point(14, 62)
        };

        _editorBundleRootTextBox = new TextBox
        {
            Location = new Point(100, 58),
            Width = _sourceGroup.Width - 204,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        _browseBundleRootButton = new Button
        {
            Text = "Browse",
            Width = 84,
            Height = 28,
            Location = new Point(_sourceGroup.Width - 96, 56),
            Anchor = AnchorStyles.Top | AnchorStyles.Right
        };
        _browseBundleRootButton.Click += (_, _) => BrowseBundleRootFolder();

        var entryFileLabel = new Label
        {
            Text = "Entry File",
            AutoSize = true,
            Location = new Point(14, 94)
        };

        _editorEntryFileTextBox = new TextBox
        {
            Location = new Point(100, 90),
            Width = 160
        };

        _loadCanvasButton = new Button
        {
            Text = "Load",
            Width = 92,
            Height = 28,
            Location = new Point(280, 88)
        };
        _loadCanvasButton.Click += async (_, _) => await LoadCanvasAsync(forceReload: false);

        _reloadCanvasButton = new Button
        {
            Text = "Reload",
            Width = 92,
            Height = 28,
            Location = new Point(378, 88)
        };
        _reloadCanvasButton.Click += async (_, _) => await LoadCanvasAsync(forceReload: true);

        _openExternalButton = new Button
        {
            Text = "Open External",
            Width = 118,
            Height = 28,
            Location = new Point(476, 88)
        };
        _openExternalButton.Click += (_, _) => OpenExternal();

        _sourceGroup.Controls.Add(editorUrlLabel);
        _sourceGroup.Controls.Add(_editorUrlTextBox);
        _sourceGroup.Controls.Add(bundleRootLabel);
        _sourceGroup.Controls.Add(_editorBundleRootTextBox);
        _sourceGroup.Controls.Add(_browseBundleRootButton);
        _sourceGroup.Controls.Add(entryFileLabel);
        _sourceGroup.Controls.Add(_editorEntryFileTextBox);
        _sourceGroup.Controls.Add(_loadCanvasButton);
        _sourceGroup.Controls.Add(_reloadCanvasButton);
        _sourceGroup.Controls.Add(_openExternalButton);

        _statusLabel = new Label
        {
            Text = "Canvas status: idle",
            AutoSize = true,
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            ForeColor = Color.FromArgb(24, 88, 150),
            Location = new Point(12, 146)
        };

        _webView = new WebView2
        {
            Location = new Point(12, 172),
            Width = ClientSize.Width - 24,
            Height = ClientSize.Height - 184,
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
        };

        Controls.Add(_sourceGroup);
        Controls.Add(_statusLabel);
        Controls.Add(_webView);

        _editorUrlTextBox.Text = _settings.EditorUrl ?? string.Empty;
        _editorBundleRootTextBox.Text = _settings.EditorBundleRootPath
            ?? FindExistingBundleRootPath()
            ?? BuildSuggestedBundleRootPath();
        _editorEntryFileTextBox.Text = string.IsNullOrWhiteSpace(_settings.EditorEntryFile)
            ? "index.html"
            : _settings.EditorEntryFile;

        ApplyLayoutOptions();

        if (_options.AutoLoadOnShown)
        {
            Shown += async (_, _) => await LoadCanvasAsync(forceReload: false);
        }
    }

    private async Task LoadCanvasAsync(bool forceReload)
    {
        if (_busy)
        {
            return;
        }

        _busy = true;
        UpdateButtons();
        try
        {
            var updatedSettings = BuildSettingsFromForm();
            await _settingsStore.SaveAsync(updatedSettings);
            _settings = updatedSettings;

            if (forceReload)
            {
                await DisposeFlowEditorRuntimeAsync();
            }

            var launchContext = await BuildLaunchContextAsync(updatedSettings);
            await EnsureWebViewReadyAsync();
            await ApplyBootstrapScriptAsync(launchContext.JavaScriptBootstrap);

            _currentUri = launchContext.EditorUri;
            _webView.Source = launchContext.EditorUri;
            _statusLabel.Text = launchContext.UsesLocalBundleHost
                ? $"Canvas status: embedded ({launchContext.EditorUri})"
                : $"Canvas status: remote/server ({launchContext.EditorUri})";
        }
        catch (Exception ex)
        {
            _statusLabel.Text = $"Canvas status: failed ({ex.Message})";
            MessageBox.Show(
                this,
                ex.ToString(),
                "Load Canvas Failed",
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

    private void ApplyLayoutOptions()
    {
        var showSource = !_options.CanvasOnly && _options.ShowSourceControls;
        var showStatus = !_options.CanvasOnly && _options.ShowStatusBar;

        _sourceGroup.Visible = showSource;
        _statusLabel.Visible = showStatus;

        if (_options.CanvasOnly)
        {
            _webView.Location = new Point(0, 0);
            _webView.Width = ClientSize.Width;
            _webView.Height = ClientSize.Height;
            _webView.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            if (_options.StartMaximized || !_options.ShowSourceControls)
            {
                WindowState = FormWindowState.Maximized;
            }
            return;
        }

        _webView.Location = new Point(12, 172);
        _webView.Width = ClientSize.Width - 24;
        _webView.Height = ClientSize.Height - 184;
        _webView.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        if (_options.StartMaximized)
        {
            WindowState = FormWindowState.Maximized;
        }
    }

    private NativeClientSettings BuildSettingsFromForm()
    {
        return _settings with
        {
            EditorUrl = NormalizeOptional(_editorUrlTextBox.Text),
            EditorBundleRootPath = NormalizeOptional(_editorBundleRootTextBox.Text),
            EditorEntryFile = string.IsNullOrWhiteSpace(_editorEntryFileTextBox.Text)
                ? "index.html"
                : _editorEntryFileTextBox.Text.Trim()
        };
    }

    private async Task<FlowEditorLaunchContext> BuildLaunchContextAsync(NativeClientSettings settings)
    {
        await DisposeFlowEditorRuntimeAsync();

        var bridgeOptions = new FlowEditorBridgeOptions
        {
            Mode = FlowEditorMode.HybridWebView,
            EditorUrl = NormalizeOptional(settings.EditorUrl),
            EmbeddedBundleRootPath = NormalizeOptional(settings.EditorBundleRootPath),
            EmbeddedEntryFile = string.IsNullOrWhiteSpace(settings.EditorEntryFile)
                ? "index.html"
                : settings.EditorEntryFile,
            PreferEmbeddedBundle = true
        };

        var bridgeService = new FlowEditorBridgeService(settings.Normalize(), bridgeOptions);
        _flowEditorRuntime = new FlowEditorHostRuntime(bridgeService);
        return await _flowEditorRuntime.CreateLaunchContextAsync();
    }

    private async Task EnsureWebViewReadyAsync()
    {
        if (_webView.CoreWebView2 is not null)
        {
            return;
        }

        await _webView.EnsureCoreWebView2Async();
        var core = _webView.CoreWebView2
            ?? throw new InvalidOperationException("WebView2 initialization failed.");
        core.NavigationStarting += HandleNavigationStarting;
        core.NavigationCompleted += HandleNavigationCompleted;
        core.Settings.AreDevToolsEnabled = true;
    }

    private async Task ApplyBootstrapScriptAsync(string script)
    {
        var core = _webView.CoreWebView2;
        if (core is null)
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(_bootstrapScriptId))
        {
            core.RemoveScriptToExecuteOnDocumentCreated(_bootstrapScriptId);
            _bootstrapScriptId = null;
        }

        _bootstrapScriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync(script);
    }

    private void HandleNavigationStarting(object? _, CoreWebView2NavigationStartingEventArgs e)
    {
        _statusLabel.Text = $"Canvas status: loading {e.Uri}";
    }

    private void HandleNavigationCompleted(object? _, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            _statusLabel.Text = $"Canvas status: loaded {_currentUri}";
            return;
        }

        _statusLabel.Text = $"Canvas status: failed ({e.WebErrorStatus})";
    }

    private void BrowseBundleRootFolder()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Select embedded flow-editor bundle root"
        };

        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _editorBundleRootTextBox.Text = dialog.SelectedPath;
        }
    }

    private void OpenExternal()
    {
        if (_currentUri is null)
        {
            MessageBox.Show(
                this,
                "Canvas URL belum tersedia. Jalankan Load terlebih dahulu.",
                "Open External",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
            return;
        }

        Process.Start(
            new ProcessStartInfo(_currentUri.AbsoluteUri)
            {
                UseShellExecute = true
            }
        );
    }

    private static string? NormalizeOptional(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    private void UpdateButtons()
    {
        if (!_sourceGroup.Visible)
        {
            return;
        }

        _browseBundleRootButton.Enabled = !_busy;
        _loadCanvasButton.Enabled = !_busy;
        _reloadCanvasButton.Enabled = !_busy;
        _openExternalButton.Enabled = !_busy && _currentUri is not null;
    }

    private static string BuildSuggestedBundleRootPath()
    {
        return Path.GetFullPath(
            Path.Combine(Environment.CurrentDirectory, "client-native", "winui", "embedded", "flow-editor")
        );
    }

    private static string? FindExistingBundleRootPath()
    {
        var candidates = new[]
        {
            BuildSuggestedBundleRootPath(),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "embedded", "flow-editor")),
            Path.GetFullPath(
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "embedded", "flow-editor")
            )
        };

        foreach (var candidate in candidates)
        {
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private async Task DisposeFlowEditorRuntimeAsync()
    {
        if (_flowEditorRuntime is null)
        {
            return;
        }

        try
        {
            await _flowEditorRuntime.DisposeAsync();
        }
        catch
        {
            // ignore cleanup failures
        }
        finally
        {
            _flowEditorRuntime = null;
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try
        {
            DisposeFlowEditorRuntimeAsync().GetAwaiter().GetResult();
        }
        catch
        {
            // ignore cleanup failures
        }

        base.OnFormClosed(e);
    }
}
