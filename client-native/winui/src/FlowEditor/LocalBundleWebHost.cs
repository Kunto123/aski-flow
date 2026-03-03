using System.Net;
using System.Net.Sockets;

namespace Aski.NativeClient.FlowEditor;

public sealed class LocalBundleWebHost : IAsyncDisposable
{
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private HttpListener? _listener;
    private CancellationTokenSource? _serveCts;
    private Task? _serveTask;
    private string? _bundleRoot;
    private string? _entryFile;
    private bool _disposed;

    public Uri? BaseUri { get; private set; }
    public bool IsRunning => _listener is not null && _listener.IsListening;

    public async Task<Uri> StartAsync(
        string bundleRootPath,
        string entryFile,
        CancellationToken cancellationToken = default
    )
    {
        ThrowIfDisposed();
        if (string.IsNullOrWhiteSpace(bundleRootPath))
        {
            throw new ArgumentException("bundleRootPath is required.", nameof(bundleRootPath));
        }

        if (string.IsNullOrWhiteSpace(entryFile))
        {
            throw new ArgumentException("entryFile is required.", nameof(entryFile));
        }

        var rootFullPath = Path.GetFullPath(bundleRootPath);
        var entryFullPath = Path.GetFullPath(Path.Combine(rootFullPath, entryFile));
        if (!Directory.Exists(rootFullPath))
        {
            throw new DirectoryNotFoundException($"Bundle root does not exist: {rootFullPath}");
        }

        if (!File.Exists(entryFullPath))
        {
            throw new FileNotFoundException(
                $"Embedded entry file not found: {entryFullPath}",
                entryFullPath
            );
        }

        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (IsRunning && BaseUri is not null)
            {
                return BaseUri;
            }

            var port = GetFreePort();
            var baseUrl = $"http://127.0.0.1:{port}/";
            var listener = new HttpListener();
            listener.Prefixes.Add(baseUrl);
            listener.Start();

            _bundleRoot = rootFullPath;
            _entryFile = entryFile.Replace('\\', '/');
            _listener = listener;
            _serveCts = new CancellationTokenSource();
            _serveTask = Task.Run(
                () => ServeLoopAsync(listener, _serveCts.Token),
                CancellationToken.None
            );

            BaseUri = new Uri(baseUrl, UriKind.Absolute);
            return BaseUri;
        }
        finally
        {
            _stateGate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        HttpListener? listener;
        CancellationTokenSource? cts;
        Task? serveTask;

        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            listener = _listener;
            cts = _serveCts;
            serveTask = _serveTask;

            _listener = null;
            _serveCts = null;
            _serveTask = null;
            _bundleRoot = null;
            _entryFile = null;
            BaseUri = null;
        }
        finally
        {
            _stateGate.Release();
        }

        if (listener is null)
        {
            return;
        }

        try
        {
            cts?.Cancel();
            listener.Stop();
            listener.Close();
            if (serveTask is not null)
            {
                await serveTask;
            }
        }
        catch (OperationCanceledException)
        {
            // expected on shutdown
        }
        catch (ObjectDisposedException)
        {
            // expected on shutdown
        }
        finally
        {
            cts?.Dispose();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        await StopAsync();
        _stateGate.Dispose();
    }

    private async Task ServeLoopAsync(HttpListener listener, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            HttpListenerContext? context = null;
            try
            {
                context = await listener.GetContextAsync().WaitAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch (HttpListenerException)
            {
                break;
            }

            if (context is not null)
            {
                _ = Task.Run(
                    () => HandleRequestAsync(context, cancellationToken),
                    CancellationToken.None
                );
            }
        }
    }

    private async Task HandleRequestAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        try
        {
            if (_bundleRoot is null || _entryFile is null)
            {
                context.Response.StatusCode = (int)HttpStatusCode.ServiceUnavailable;
                context.Response.Close();
                return;
            }

            if (
                context.Request.HttpMethod != HttpMethod.Get.Method
                && context.Request.HttpMethod != HttpMethod.Head.Method
            )
            {
                context.Response.StatusCode = (int)HttpStatusCode.MethodNotAllowed;
                context.Response.Close();
                return;
            }

            var requestPath = Uri.UnescapeDataString(context.Request.Url?.AbsolutePath ?? "/");
            if (string.IsNullOrWhiteSpace(requestPath) || requestPath == "/")
            {
                requestPath = "/" + _entryFile;
            }

            var relativePath = requestPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var candidatePath = Path.GetFullPath(Path.Combine(_bundleRoot, relativePath));

            var rootWithSeparator = _bundleRoot.TrimEnd(Path.DirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var isInsideRoot = candidatePath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase)
                || string.Equals(candidatePath, _bundleRoot, StringComparison.OrdinalIgnoreCase);

            if (!isInsideRoot)
            {
                context.Response.StatusCode = (int)HttpStatusCode.Forbidden;
                context.Response.Close();
                return;
            }

            if (!File.Exists(candidatePath))
            {
                candidatePath = Path.Combine(_bundleRoot, _entryFile);
            }

            var contentType = GetContentType(candidatePath);
            context.Response.StatusCode = (int)HttpStatusCode.OK;
            context.Response.ContentType = contentType;
            context.Response.Headers["Cache-Control"] = "no-cache";

            if (context.Request.HttpMethod == HttpMethod.Head.Method)
            {
                context.Response.Close();
                return;
            }

            var bytes = await File.ReadAllBytesAsync(candidatePath, cancellationToken);
            context.Response.ContentLength64 = bytes.LongLength;
            await context.Response.OutputStream.WriteAsync(bytes, cancellationToken);
            context.Response.OutputStream.Close();
        }
        catch
        {
            try
            {
                context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
                context.Response.Close();
            }
            catch
            {
                // ignore
            }
        }
    }

    private static int GetFreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private static string GetContentType(string filePath)
    {
        return Path.GetExtension(filePath).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".ico" => "image/x-icon",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".ttf" => "font/ttf",
            ".map" => "application/json; charset=utf-8",
            _ => "application/octet-stream"
        };
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(LocalBundleWebHost));
        }
    }
}
