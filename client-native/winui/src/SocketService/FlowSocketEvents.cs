namespace Aski.NativeClient.SocketService;

public static class FlowSocketEventNames
{
    public const string Connect = "connect";
    public const string Progress = "progress";
    public const string Error = "error";
    public const string RunEnd = "run_end";
    public const string CurrentNodeRunning = "current_node_running";
    public const string ReconnectError = "reconnect_error";
    public const string Disconnect = "disconnect";

    public const string RunNode = "run_node";
    public const string ProcessFile = "process_file";
    public const string UpdateAppConfig = "update_app_config";
}

public sealed record FlowProgressEvent(string InstanceName, object? Output, bool IsDone);

public sealed record FlowErrorEvent(string InstanceName, string NodeName, string Error);

public sealed record FlowCurrentNodeRunningEvent(string InstanceName);

public sealed record FlowRunEndEvent(object? Output);

public sealed record RunNodeRequest(
    string JsonFile,
    string NodeName,
    Dictionary<string, object?>? Parameters = null,
    string? ClientId = null,
    string? AuthToken = null
);

public sealed record ProcessFileRequest(
    string JsonFile,
    Dictionary<string, object?>? Parameters = null,
    string? ClientId = null,
    string? AuthToken = null
);
