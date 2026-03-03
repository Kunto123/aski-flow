using System.Net.Http.Headers;
using Aski.NativeClient.Settings;
using Aski.NativeClient.SocketService;

var options = ParseArgs(args);
var settings = new NativeClientSettings
{
    ServerHost = options.Host,
    ServerPort = options.Port,
    UseHttps = options.UseHttps,
    ApiVersion = options.ApiVersion,
    AuthToken = options.AuthToken,
    ClientId = string.IsNullOrWhiteSpace(options.ClientId) ? string.Empty : options.ClientId,
    RequestTimeoutSeconds = options.TimeoutSeconds
}.Normalize();

Console.WriteLine($"[connection-check] target={settings.BuildServerUri(includeApiVersion: false)}");
Console.WriteLine($"[connection-check] client_id={settings.ClientId}");

await CheckHealthAsync(settings);
await CheckSocketAsync(settings, options.SocketWaitSeconds);

Console.WriteLine("[connection-check] SUCCESS");
return 0;

static async Task CheckHealthAsync(NativeClientSettings settings)
{
    using var httpClient = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(settings.RequestTimeoutSeconds)
    };
    var healthUri = new Uri(settings.BuildServerUri(includeApiVersion: false), "health");
    using var request = new HttpRequestMessage(HttpMethod.Get, healthUri);
    request.Headers.TryAddWithoutValidation("X-Aski-Client-Id", settings.ClientId);
    if (!string.IsNullOrWhiteSpace(settings.AuthToken))
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.AuthToken);
        request.Headers.TryAddWithoutValidation("X-Aski-Auth-Token", settings.AuthToken);
    }

    using var response = await httpClient.SendAsync(request);
    var body = await response.Content.ReadAsStringAsync();
    if (!response.IsSuccessStatusCode)
    {
        throw new InvalidOperationException(
            $"Health check failed with {(int)response.StatusCode} {response.ReasonPhrase}. Body={body}"
        );
    }

    Console.WriteLine($"[connection-check] health_ok body={body}");
}

static async Task CheckSocketAsync(NativeClientSettings settings, int waitSeconds)
{
    await using var socketClient = FlowSocketClientFactory.Create(settings);
    if (socketClient is FlowSocketClientStub)
    {
        throw new InvalidOperationException(
            "Socket stub is active (ASKI_NATIVE_SOCKET_STUB=true). Disable it for real connection check."
        );
    }

    var connectedSignal = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    var disconnectedSignal = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
    var errorSignal = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);

    socketClient.Connected += () =>
    {
        Console.WriteLine("[connection-check] socket_connected");
        connectedSignal.TrySetResult(true);
    };
    socketClient.Disconnected += reason =>
    {
        Console.WriteLine($"[connection-check] socket_disconnected reason={reason ?? "-"}");
        disconnectedSignal.TrySetResult(reason);
    };
    socketClient.ErrorReceived += error =>
    {
        Console.WriteLine($"[connection-check] socket_error message={error.Error}");
        errorSignal.TrySetResult(error.Error);
    };

    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
    await socketClient.ConnectAsync(cts.Token);
    await WaitEitherAsync(
        connectedSignal.Task,
        errorSignal.Task,
        TimeSpan.FromSeconds(20),
        "Socket connect timeout."
    );

    Console.WriteLine(
        $"[connection-check] socket_status connected={socketClient.IsConnected} sid={socketClient.SessionId ?? "-"}"
    );

    await Task.Delay(TimeSpan.FromSeconds(waitSeconds), cts.Token);
    await socketClient.DisconnectAsync(cts.Token);
    await WaitEitherAsync(
        disconnectedSignal.Task,
        errorSignal.Task,
        TimeSpan.FromSeconds(10),
        "Socket disconnect timeout."
    );
}

static async Task WaitEitherAsync(
    Task firstTask,
    Task<string> errorTask,
    TimeSpan timeout,
    string timeoutMessage
)
{
    var completed = await Task.WhenAny(firstTask, errorTask, Task.Delay(timeout));
    if (completed == errorTask)
    {
        throw new InvalidOperationException($"Socket error: {errorTask.Result}");
    }
    if (completed != firstTask)
    {
        throw new TimeoutException(timeoutMessage);
    }
}

static CliOptions ParseArgs(string[] args)
{
    var options = new CliOptions();

    for (var i = 0; i < args.Length; i++)
    {
        var arg = args[i];
        switch (arg)
        {
            case "--host":
                options.Host = ReadValue(args, ref i, "--host");
                break;
            case "--port":
                options.Port = int.Parse(ReadValue(args, ref i, "--port"));
                break;
            case "--https":
                options.UseHttps = true;
                break;
            case "--api-version":
                options.ApiVersion = ReadValue(args, ref i, "--api-version");
                break;
            case "--auth-token":
                options.AuthToken = ReadValue(args, ref i, "--auth-token");
                break;
            case "--client-id":
                options.ClientId = ReadValue(args, ref i, "--client-id");
                break;
            case "--timeout":
                options.TimeoutSeconds = int.Parse(ReadValue(args, ref i, "--timeout"));
                break;
            case "--socket-wait":
                options.SocketWaitSeconds = int.Parse(ReadValue(args, ref i, "--socket-wait"));
                break;
            default:
                throw new ArgumentException($"Unknown argument: {arg}");
        }
    }

    return options;
}

static string ReadValue(string[] args, ref int index, string optionName)
{
    var nextIndex = index + 1;
    if (nextIndex >= args.Length)
    {
        throw new ArgumentException($"Missing value for option {optionName}");
    }

    index = nextIndex;
    return args[nextIndex];
}

sealed class CliOptions
{
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 8000;
    public bool UseHttps { get; set; }
    public string ApiVersion { get; set; } = "v1";
    public string? AuthToken { get; set; }
    public string? ClientId { get; set; }
    public int TimeoutSeconds { get; set; } = 10;
    public int SocketWaitSeconds { get; set; } = 2;
}
