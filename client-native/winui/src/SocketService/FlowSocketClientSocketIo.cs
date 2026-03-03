using System.Collections.Specialized;
using System.Text.Json;
using Aski.NativeClient.Settings;
using SocketIOClient;
using SocketIOClient.Common;

namespace Aski.NativeClient.SocketService;

public sealed class FlowSocketClientSocketIo : IFlowSocketClient
{
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private NativeClientSettings _settings;
    private SocketIO? _socket;
    private bool _disposed;

    public FlowSocketClientSocketIo(NativeClientSettings settings)
    {
        _settings = settings.Normalize();
    }

    public bool IsConnected => _socket?.Connected == true;
    public string? SessionId => _socket?.Id;

    public event Action? Connected;
    public event Action<string?>? Disconnected;
    public event Action<FlowProgressEvent>? ProgressReceived;
    public event Action<FlowErrorEvent>? ErrorReceived;
    public event Action<FlowRunEndEvent>? RunEndReceived;
    public event Action<FlowCurrentNodeRunningEvent>? CurrentNodeRunningReceived;

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _lifecycleGate.WaitAsync(cancellationToken);
        try
        {
            if (_socket?.Connected == true)
            {
                return;
            }

            if (_socket is null)
            {
                _socket = BuildSocket();
                WireEvents(_socket);
            }

            await _socket.ConnectAsync(cancellationToken);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        await _lifecycleGate.WaitAsync(cancellationToken);
        try
        {
            if (_socket is null)
            {
                return;
            }

            if (_socket.Connected)
            {
                await _socket.DisconnectAsync(cancellationToken);
            }

            _socket.Dispose();
            _socket = null;
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task EmitRunNodeAsync(
        RunNodeRequest request,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(request);
        await EnsureConnectedAsync(cancellationToken);
        var payload = BuildRunNodePayload(request);
        await _socket!.EmitAsync(
            FlowSocketEventNames.RunNode,
            new object[] { payload },
            cancellationToken
        );
    }

    public async Task EmitProcessFileAsync(
        ProcessFileRequest request,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(request);
        await EnsureConnectedAsync(cancellationToken);
        var payload = BuildProcessFilePayload(request);
        await _socket!.EmitAsync(
            FlowSocketEventNames.ProcessFile,
            new object[] { payload },
            cancellationToken
        );
    }

    public async Task EmitUpdateAppConfigAsync(
        IReadOnlyDictionary<string, string> appConfig,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(appConfig);
        await EnsureConnectedAsync(cancellationToken);
        var payload = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in appConfig)
        {
            payload[item.Key] = item.Value;
        }
        AddClientIdentity(payload);
        await _socket!.EmitAsync(
            FlowSocketEventNames.UpdateAppConfig,
            new object[] { payload },
            cancellationToken
        );
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        try
        {
            await DisconnectAsync();
        }
        finally
        {
            _lifecycleGate.Dispose();
        }
    }

    private async Task EnsureConnectedAsync(CancellationToken cancellationToken)
    {
        if (_socket?.Connected == true)
        {
            return;
        }

        await ConnectAsync(cancellationToken);
    }

    private SocketIO BuildSocket()
    {
        var query = new NameValueCollection
        {
            { "client_id", _settings.ClientId }
        };

        var authPayload = new Dictionary<string, object?>
        {
            ["client_id"] = _settings.ClientId
        };

        var extraHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["X-Aski-Client-Id"] = _settings.ClientId
        };

        if (!string.IsNullOrWhiteSpace(_settings.AuthToken))
        {
            query["auth_token"] = _settings.AuthToken;
            authPayload["auth_token"] = _settings.AuthToken;
            extraHeaders["X-Aski-Auth-Token"] = _settings.AuthToken;
            extraHeaders["Authorization"] = $"Bearer {_settings.AuthToken}";
        }

        var options = new SocketIOOptions
        {
            EIO = EngineIO.V4,
            Transport = TransportProtocol.WebSocket,
            Reconnection = true,
            ReconnectionAttempts = 5,
            ReconnectionDelayMax = 5000,
            Query = query,
            Auth = authPayload,
            ExtraHeaders = extraHeaders
        };

        var uri = new Uri(_settings.BuildSocketUrl(), UriKind.Absolute);
        return new SocketIO(uri, options);
    }

    private void WireEvents(SocketIO socket)
    {
        socket.OnConnected += (_, _) => Connected?.Invoke();
        socket.OnDisconnected += (_, reason) => Disconnected?.Invoke(reason);
        socket.OnReconnectError += (_, error) => Disconnected?.Invoke(error?.Message);
        socket.OnError += (_, errorMessage) =>
        {
            var message = string.IsNullOrWhiteSpace(errorMessage)
                ? "Socket error"
                : errorMessage;
            ErrorReceived?.Invoke(new FlowErrorEvent(string.Empty, string.Empty, message));
        };

        socket.On(
            FlowSocketEventNames.Progress,
            context =>
            {
                ProgressReceived?.Invoke(ParseProgress(context));
                return Task.CompletedTask;
            }
        );

        socket.On(
            FlowSocketEventNames.Error,
            context =>
            {
                ErrorReceived?.Invoke(ParseError(context));
                return Task.CompletedTask;
            }
        );

        socket.On(
            FlowSocketEventNames.RunEnd,
            context =>
            {
                RunEndReceived?.Invoke(ParseRunEnd(context));
                return Task.CompletedTask;
            }
        );

        socket.On(
            FlowSocketEventNames.CurrentNodeRunning,
            context =>
            {
                CurrentNodeRunningReceived?.Invoke(ParseCurrentNodeRunning(context));
                return Task.CompletedTask;
            }
        );
    }

    private Dictionary<string, object?> BuildRunNodePayload(RunNodeRequest request)
    {
        var payload = new Dictionary<string, object?>
        {
            ["jsonFile"] = request.JsonFile,
            ["nodeName"] = request.NodeName
        };

        if (request.Parameters is { Count: > 0 })
        {
            payload["parameters"] = request.Parameters;
        }

        AddClientIdentity(payload, request.ClientId, request.AuthToken);
        return payload;
    }

    private Dictionary<string, object?> BuildProcessFilePayload(ProcessFileRequest request)
    {
        var payload = new Dictionary<string, object?>
        {
            ["jsonFile"] = request.JsonFile
        };

        if (request.Parameters is { Count: > 0 })
        {
            payload["parameters"] = request.Parameters;
        }

        AddClientIdentity(payload, request.ClientId, request.AuthToken);
        return payload;
    }

    private void AddClientIdentity(
        IDictionary<string, object?> payload,
        string? clientId = null,
        string? authToken = null
    )
    {
        payload["client_id"] = string.IsNullOrWhiteSpace(clientId)
            ? _settings.ClientId
            : clientId;

        var token = string.IsNullOrWhiteSpace(authToken) ? _settings.AuthToken : authToken;
        if (!string.IsNullOrWhiteSpace(token))
        {
            payload["auth_token"] = token;
        }
    }

    private static FlowProgressEvent ParseProgress(IEventContext context)
    {
        var payload = TryGetJsonPayload(context);
        var instanceName = GetString(payload, "instanceName") ?? string.Empty;
        var isDone = GetBool(payload, "isDone", defaultValue: true);
        var output = GetJsonValueOrNull(payload, "output");
        return new FlowProgressEvent(instanceName, output, isDone);
    }

    private static FlowErrorEvent ParseError(IEventContext context)
    {
        var payload = TryGetJsonPayload(context);
        var instanceName = GetString(payload, "instanceName") ?? string.Empty;
        var nodeName = GetString(payload, "nodeName") ?? string.Empty;
        var error =
            GetString(payload, "error")
            ?? GetString(payload, "message")
            ?? "Unknown socket error";
        return new FlowErrorEvent(instanceName, nodeName, error);
    }

    private static FlowRunEndEvent ParseRunEnd(IEventContext context)
    {
        var payload = TryGetJsonPayload(context);
        var output = GetJsonValueOrNull(payload, "output");
        return new FlowRunEndEvent(output);
    }

    private static FlowCurrentNodeRunningEvent ParseCurrentNodeRunning(IEventContext context)
    {
        var payload = TryGetJsonPayload(context);
        var instanceName = GetString(payload, "instanceName") ?? string.Empty;
        return new FlowCurrentNodeRunningEvent(instanceName);
    }

    private static JsonElement? TryGetJsonPayload(IEventContext context)
    {
        try
        {
            return context.GetValue<JsonElement>(0);
        }
        catch
        {
            if (string.IsNullOrWhiteSpace(context.RawText))
            {
                return null;
            }

            try
            {
                using var json = JsonDocument.Parse(context.RawText);
                return json.RootElement.Clone();
            }
            catch
            {
                return null;
            }
        }
    }

    private static string? GetString(JsonElement? payload, string propertyName)
    {
        if (!payload.HasValue)
        {
            return null;
        }

        var json = payload.Value;
        if (!json.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => bool.TrueString,
            JsonValueKind.False => bool.FalseString,
            _ => null
        };
    }

    private static bool GetBool(JsonElement? payload, string propertyName, bool defaultValue)
    {
        if (!payload.HasValue)
        {
            return defaultValue;
        }

        if (!payload.Value.TryGetProperty(propertyName, out var value))
        {
            return defaultValue;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            _ => defaultValue
        };
    }

    private static object? GetJsonValueOrNull(JsonElement? payload, string propertyName)
    {
        if (!payload.HasValue)
        {
            return null;
        }

        return payload.Value.TryGetProperty(propertyName, out var value)
            ? value.Clone()
            : null;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(FlowSocketClientSocketIo));
        }
    }
}
