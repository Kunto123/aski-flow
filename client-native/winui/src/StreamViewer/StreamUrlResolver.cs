using System.Text.RegularExpressions;
using Aski.NativeClient.Settings;

namespace Aski.NativeClient.StreamViewer;

public sealed class StreamUrlResolver
{
    private static readonly Regex MjpegRegex = new(
        "/stream/(?<id>[^/.?]+)/(?<tail>.*)$|/stream/(?<id2>[^/.?]+)\\.(mjpg|mjpeg)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled
    );

    private static readonly Regex PredictionsRegex = new(
        "/stream/(?<id>[^/.?]+)/predictions\\.json$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled
    );

    private readonly NativeClientSettings _settings;

    public StreamUrlResolver(NativeClientSettings settings)
    {
        _settings = settings.Normalize();
    }

    public string ResolveMjpegUrl(string streamReferenceOrUrl)
    {
        var streamId = ExtractStreamId(streamReferenceOrUrl);
        if (streamId is null && Uri.TryCreate(streamReferenceOrUrl, UriKind.Absolute, out var absolute))
        {
            if (
                absolute.AbsolutePath.EndsWith(".mjpg", StringComparison.OrdinalIgnoreCase)
                || absolute.AbsolutePath.EndsWith(".mjpeg", StringComparison.OrdinalIgnoreCase)
            )
            {
                return absolute.ToString();
            }
        }

        if (string.IsNullOrWhiteSpace(streamId))
        {
            throw new ArgumentException("Unable to resolve stream id from input.", nameof(streamReferenceOrUrl));
        }

        var baseUri = _settings.BuildServerUri(includeApiVersion: true).ToString().TrimEnd('/');
        return $"{baseUri}/stream/{streamId}.mjpg";
    }

    public string ResolvePredictionsUrl(string streamReferenceOrUrl)
    {
        var streamId = ExtractStreamId(streamReferenceOrUrl);
        if (streamId is null && Uri.TryCreate(streamReferenceOrUrl, UriKind.Absolute, out var absolute))
        {
            if (absolute.AbsolutePath.EndsWith("/predictions.json", StringComparison.OrdinalIgnoreCase))
            {
                return absolute.ToString();
            }
        }

        if (string.IsNullOrWhiteSpace(streamId))
        {
            throw new ArgumentException("Unable to resolve stream id from input.", nameof(streamReferenceOrUrl));
        }

        var baseUri = _settings.BuildServerUri(includeApiVersion: true).ToString().TrimEnd('/');
        return $"{baseUri}/stream/{streamId}/predictions.json";
    }

    public string? ExtractStreamId(string streamReferenceOrUrl)
    {
        var raw = (streamReferenceOrUrl ?? string.Empty).Trim();
        if (raw.Length == 0)
        {
            return null;
        }

        if (raw.StartsWith("stream://", StringComparison.OrdinalIgnoreCase))
        {
            return raw["stream://".Length..];
        }

        if (Uri.TryCreate(raw, UriKind.Absolute, out var uri))
        {
            var predMatch = PredictionsRegex.Match(uri.AbsolutePath);
            if (predMatch.Success)
            {
                return predMatch.Groups["id"].Value;
            }

            var mjpegMatch = MjpegRegex.Match(uri.AbsolutePath);
            if (mjpegMatch.Success)
            {
                return GetFirstNonEmpty(mjpegMatch.Groups["id"].Value, mjpegMatch.Groups["id2"].Value);
            }
        }

        // Fallback: treat raw plain value as stream id.
        return raw;
    }

    private static string GetFirstNonEmpty(string first, string second)
        => !string.IsNullOrWhiteSpace(first) ? first : second;
}
