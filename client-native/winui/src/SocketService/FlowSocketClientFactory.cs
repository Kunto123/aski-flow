using Aski.NativeClient.Settings;

namespace Aski.NativeClient.SocketService;

public static class FlowSocketClientFactory
{
    public static IFlowSocketClient Create(NativeClientSettings settings)
    {
        var forceStub = Environment.GetEnvironmentVariable("ASKI_NATIVE_SOCKET_STUB");
        if (string.Equals(forceStub, "true", StringComparison.OrdinalIgnoreCase))
        {
            return new FlowSocketClientStub(settings);
        }

        return new FlowSocketClientSocketIo(settings);
    }
}
