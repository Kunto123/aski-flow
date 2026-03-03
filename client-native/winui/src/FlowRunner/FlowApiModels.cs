namespace Aski.NativeClient.FlowRunner;

public sealed record StopResponse(bool Stopped, int? StoppedCount = null, string? Error = null);

public sealed record UpdateRoiResponse(
    bool Updated,
    string? StreamId = null,
    string? Error = null
);

public sealed record ClientCameraIngestResponse(
    bool Ingested,
    string? StreamId = null,
    string? StreamRef = null,
    string? MjpegUrl = null,
    string? PredictionsUrl = null,
    string? Error = null
);

public sealed record LocalModelFile(
    string Path,
    string Basename,
    string Extension,
    string Kind,
    string SearchRoot
);

public sealed record LocalModelFilesResponse(
    IReadOnlyList<LocalModelFile> Files,
    int Count
);

public sealed record OcrLanguagesResponse(
    IReadOnlyList<string> Languages,
    int Count,
    IReadOnlyList<string> Recommended,
    bool TesseractAvailable,
    string? Error = null
);

public sealed record DatasetSummary(
    string Id,
    string Name,
    string Path,
    string FolderName
);

public sealed record GenericApiError(string Error, int StatusCode)
{
    public static GenericApiError FromHttp(int statusCode, string error)
        => new(error, statusCode);
}
