using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Aski.NativeClient.Settings;

namespace Aski.NativeClient.FlowRunner;

public sealed class AskiRestClient
{
    private readonly HttpClient _httpClient;
    private NativeClientSettings _settings;

    public AskiRestClient(HttpClient httpClient, NativeClientSettings settings)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _settings = settings.Normalize();
        ApplyHttpClientConfiguration();
    }

    public void UpdateSettings(NativeClientSettings settings)
    {
        _settings = settings.Normalize();
        ApplyHttpClientConfiguration();
    }

    public async Task<StopResponse> StopStreamAsync(
        string streamId,
        CancellationToken cancellationToken = default
    )
    {
        EnsureRequired(streamId, nameof(streamId));
        var encoded = Uri.EscapeDataString(streamId);
        return await PostJsonAsync<object, StopResponse>(
            BuildApiPath($"/stream/{encoded}/stop"),
            null,
            cancellationToken
        );
    }

    public async Task<StopResponse> StopStreamsByOwnerAsync(
        string nodeName,
        CancellationToken cancellationToken = default
    )
    {
        EnsureRequired(nodeName, nameof(nodeName));
        var encoded = Uri.EscapeDataString(nodeName);
        return await PostJsonAsync<object, StopResponse>(
            BuildApiPath($"/stream/owner/{encoded}/stop"),
            null,
            cancellationToken
        );
    }

    public async Task<StopResponse> StopAllCameraStreamsAsync(
        string? clientSessionId = null,
        CancellationToken cancellationToken = default
    )
    {
        var payload = new
        {
            client_session_id = string.IsNullOrWhiteSpace(clientSessionId)
                ? _settings.ClientId
                : clientSessionId
        };

        return await PostJsonAsync<object, StopResponse>(
            BuildApiPath("/stream/camera/stop"),
            payload,
            cancellationToken
        );
    }

    public async Task<StopResponse> StopCameraStreamsByIndexAsync(
        int cameraIndex,
        string? clientSessionId = null,
        CancellationToken cancellationToken = default
    )
    {
        var payload = new
        {
            camera_index = cameraIndex,
            client_session_id = string.IsNullOrWhiteSpace(clientSessionId)
                ? _settings.ClientId
                : clientSessionId
        };

        return await PostJsonAsync<object, StopResponse>(
            BuildApiPath("/stream/camera/by-index/stop"),
            payload,
            cancellationToken
        );
    }

    public async Task<UpdateRoiResponse> UpdateRoiStreamParamsAsync(
        string streamId,
        object roiParams,
        CancellationToken cancellationToken = default
    )
    {
        EnsureRequired(streamId, nameof(streamId));
        var encoded = Uri.EscapeDataString(streamId);
        return await PostJsonAsync<object, UpdateRoiResponse>(
            BuildApiPath($"/stream/{encoded}/roi/params"),
            roiParams,
            cancellationToken
        );
    }

    public async Task<JsonDocument> GetStreamPredictionsAsync(
        string streamId,
        CancellationToken cancellationToken = default
    )
    {
        EnsureRequired(streamId, nameof(streamId));
        var encoded = Uri.EscapeDataString(streamId);
        return await GetJsonDocumentAsync(
            BuildApiPath($"/stream/{encoded}/predictions.json"),
            cancellationToken
        );
    }

    public async Task<ClientCameraIngestResponse> IngestClientCameraFrameAsync(
        byte[] jpegFrame,
        int cameraIndex,
        int? width = null,
        int? height = null,
        float? fps = null,
        string? clientSessionId = null,
        CancellationToken cancellationToken = default
    )
    {
        if (jpegFrame is null || jpegFrame.Length == 0)
        {
            throw new ArgumentException("JPEG frame payload is required.", nameof(jpegFrame));
        }

        var query = new StringBuilder();
        query.Append($"camera_index={cameraIndex}");
        if (width.HasValue)
        {
            query.Append($"&width={width.Value}");
        }
        if (height.HasValue)
        {
            query.Append($"&height={height.Value}");
        }
        if (fps.HasValue)
        {
            query.Append($"&fps={fps.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)}");
        }

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            BuildApiPath($"/stream/client-camera/frame?{query}")
        );
        ApplyAuthHeaders(request);
        request.Headers.TryAddWithoutValidation(
            "X-Aski-Client-Session-Id",
            string.IsNullOrWhiteSpace(clientSessionId) ? _settings.ClientId : clientSessionId
        );
        request.Headers.TryAddWithoutValidation("X-Aski-Client-Id", _settings.ClientId);
        request.Content = new ByteArrayContent(jpegFrame);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        return await ReadRequiredJsonAsync<ClientCameraIngestResponse>(response, cancellationToken);
    }

    public async Task<JsonDocument> GetNodeExtensionsAsync(CancellationToken cancellationToken = default)
        => await GetJsonDocumentAsync(BuildApiPath("/node/extensions"), cancellationToken);

    public async Task<LocalModelFilesResponse> GetLocalModelFilesAsync(
        CancellationToken cancellationToken = default
    )
        => await GetJsonAsync<LocalModelFilesResponse>(
            BuildApiPath("/node/local-model-files"),
            cancellationToken
        );

    public async Task<OcrLanguagesResponse> GetOcrLanguagesAsync(
        CancellationToken cancellationToken = default
    )
        => await GetJsonAsync<OcrLanguagesResponse>(
            BuildApiPath("/node/ocr-languages"),
            cancellationToken
        );

    public async Task<IReadOnlyList<DatasetSummary>> ListDatasetsAsync(
        CancellationToken cancellationToken = default
    )
    {
        var items = await GetJsonAsync<List<DatasetSummary>>(
            BuildApiPath("/datasets"),
            cancellationToken
        );
        return items;
    }

    private async Task<TResponse> PostJsonAsync<TRequest, TResponse>(
        string path,
        TRequest? payload,
        CancellationToken cancellationToken
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        ApplyAuthHeaders(request);

        if (payload is not null)
        {
            request.Content = JsonContent.Create(payload);
        }

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        return await ReadRequiredJsonAsync<TResponse>(response, cancellationToken);
    }

    private async Task<T> GetJsonAsync<T>(
        string path,
        CancellationToken cancellationToken
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        ApplyAuthHeaders(request);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        return await ReadRequiredJsonAsync<T>(response, cancellationToken);
    }

    private async Task<JsonDocument> GetJsonDocumentAsync(
        string path,
        CancellationToken cancellationToken
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        ApplyAuthHeaders(request);
        using var response = await _httpClient.SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            await ThrowHttpError(response, cancellationToken);
        }

        await using var contentStream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return await JsonDocument.ParseAsync(contentStream, cancellationToken: cancellationToken);
    }

    private async Task<T> ReadRequiredJsonAsync<T>(
        HttpResponseMessage response,
        CancellationToken cancellationToken
    )
    {
        if (!response.IsSuccessStatusCode)
        {
            await ThrowHttpError(response, cancellationToken);
        }

        var model = await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken);
        if (model is null)
        {
            throw new InvalidOperationException(
                $"Response payload for {typeof(T).Name} is empty or invalid."
            );
        }

        return model;
    }

    private static async Task ThrowHttpError(
        HttpResponseMessage response,
        CancellationToken cancellationToken
    )
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException(
            $"Request failed with {(int)response.StatusCode} {response.ReasonPhrase}. Body: {body}"
        );
    }

    private void ApplyAuthHeaders(HttpRequestMessage request)
    {
        request.Headers.TryAddWithoutValidation("X-Aski-Client-Id", _settings.ClientId);

        if (!string.IsNullOrWhiteSpace(_settings.AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Bearer",
                _settings.AuthToken
            );
            request.Headers.TryAddWithoutValidation("X-Aski-Auth-Token", _settings.AuthToken);
        }
    }

    private string BuildApiPath(string path)
    {
        var relativePath = (path ?? string.Empty).Trim();
        if (!relativePath.StartsWith('/'))
        {
            relativePath = "/" + relativePath;
        }

        var prefix = string.IsNullOrWhiteSpace(_settings.ApiVersion)
            ? string.Empty
            : "/" + _settings.ApiVersion.Trim().Trim('/');

        return prefix + relativePath;
    }

    private static void EnsureRequired(string value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Value is required.", paramName);
        }
    }

    private void ApplyHttpClientConfiguration()
    {
        _httpClient.BaseAddress = _settings.BuildServerUri(includeApiVersion: false);
        _httpClient.Timeout = TimeSpan.FromSeconds(_settings.RequestTimeoutSeconds);
    }
}
