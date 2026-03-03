using System.Text.Json;
using System.Text.RegularExpressions;

namespace Aski.NativeClient.StreamViewer;

public sealed class OutputInterpreter
{
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif", ".svg"
    };

    private static readonly HashSet<string> VideoExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp4", ".webm", ".mov", ".avi", ".mkv", ".m3u8"
    };

    private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".wav", ".ogg", ".aac", ".m4a"
    };

    private static readonly Regex StreamRefRegex = new(
        "^stream://(?<id>[a-zA-Z0-9_-]+)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase
    );

    public IReadOnlyList<NativeOutputItem> Interpret(object? raw)
    {
        if (raw is null)
        {
            return new[] { new NativeOutputItem(NativeOutputKind.Empty) };
        }

        if (raw is JsonElement jsonElement)
        {
            if (jsonElement.ValueKind == JsonValueKind.Array)
            {
                var list = new List<NativeOutputItem>();
                foreach (var element in jsonElement.EnumerateArray())
                {
                    list.Add(InterpretJsonElement(element));
                }
                return list;
            }

            return new[] { InterpretJsonElement(jsonElement) };
        }

        if (raw is string text)
        {
            return new[] { InterpretString(text) };
        }

        if (raw is IEnumerable<object?> rawEnumerable)
        {
            var list = new List<NativeOutputItem>();
            foreach (var item in rawEnumerable)
            {
                list.AddRange(Interpret(item));
            }
            return list;
        }

        try
        {
            var serialized = JsonSerializer.SerializeToElement(raw);
            return new[] { InterpretJsonElement(serialized) };
        }
        catch
        {
            return new[]
            {
                new NativeOutputItem(NativeOutputKind.Text, Text: raw.ToString())
            };
        }
    }

    private static NativeOutputItem InterpretJsonElement(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => InterpretString(element.GetString() ?? string.Empty),
            JsonValueKind.Object => new NativeOutputItem(
                NativeOutputKind.Json,
                Json: element.Clone()
            ),
            JsonValueKind.Array => new NativeOutputItem(
                NativeOutputKind.Json,
                Json: element.Clone()
            ),
            JsonValueKind.Number => new NativeOutputItem(
                NativeOutputKind.Text,
                Text: element.ToString()
            ),
            JsonValueKind.True => new NativeOutputItem(NativeOutputKind.Text, Text: bool.TrueString),
            JsonValueKind.False => new NativeOutputItem(NativeOutputKind.Text, Text: bool.FalseString),
            JsonValueKind.Null => new NativeOutputItem(NativeOutputKind.Empty),
            _ => new NativeOutputItem(NativeOutputKind.Unknown, Text: element.ToString())
        };
    }

    private static NativeOutputItem InterpretString(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return new NativeOutputItem(NativeOutputKind.Empty);
        }

        var streamMatch = StreamRefRegex.Match(trimmed);
        if (streamMatch.Success)
        {
            var streamId = streamMatch.Groups["id"].Value;
            return new NativeOutputItem(
                NativeOutputKind.Stream,
                Text: trimmed,
                StreamId: streamId
            );
        }

        if (LooksLikeJson(trimmed, out var json))
        {
            return new NativeOutputItem(NativeOutputKind.Json, Json: json);
        }

        if (TryClassifyAsUrl(trimmed, out var kind))
        {
            return new NativeOutputItem(kind, Url: trimmed, Text: trimmed);
        }

        return new NativeOutputItem(NativeOutputKind.Text, Text: trimmed);
    }

    private static bool LooksLikeJson(string raw, out JsonElement? element)
    {
        element = null;
        if (!(raw.StartsWith('{') || raw.StartsWith('[')))
        {
            return false;
        }

        try
        {
            using var json = JsonDocument.Parse(raw);
            element = json.RootElement.Clone();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryClassifyAsUrl(string raw, out NativeOutputKind kind)
    {
        kind = NativeOutputKind.Unknown;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (
            uri.Scheme != Uri.UriSchemeHttp
            && uri.Scheme != Uri.UriSchemeHttps
            && uri.Scheme != Uri.UriSchemeFile
        )
        {
            return false;
        }

        var lowerPath = uri.AbsolutePath.ToLowerInvariant();
        if (lowerPath.EndsWith(".mjpg") || lowerPath.EndsWith(".mjpeg") || lowerPath.Contains("/stream/"))
        {
            kind = NativeOutputKind.Stream;
            return true;
        }

        var ext = Path.GetExtension(lowerPath);
        if (ImageExtensions.Contains(ext))
        {
            kind = NativeOutputKind.ImageUrl;
            return true;
        }

        if (VideoExtensions.Contains(ext))
        {
            kind = NativeOutputKind.VideoUrl;
            return true;
        }

        if (AudioExtensions.Contains(ext))
        {
            kind = NativeOutputKind.AudioUrl;
            return true;
        }

        kind = NativeOutputKind.Text;
        return true;
    }
}
