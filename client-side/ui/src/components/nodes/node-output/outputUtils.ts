import { OutputType } from "../../../nodes-configuration/types";
import { getRestApiUrl } from "../../../config/config";

const isLocalOrAnyHost = (host: string) => {
  const normalized = (host || "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  );
};

const isBackendMediaPath = (path: string) => {
  if (!path) return false;
  return path.startsWith("/stream/") || path.startsWith("/asset/") || path.startsWith("/image/");
};

export const getFileExtension = (url: string) => {
  const extensionMatch = url.match(/\.([0-9a-z]+)(?:[\?#]|$)/i);
  return extensionMatch ? extensionMatch[1] : "";
};

export const getGeneratedFileName = (url: string, nodeName: string) => {
  const extension = getFileExtension(url);
  return `${nodeName}-output.${extension}`;
};

export const isStreamUrl = (url: string) => {
  if (!url || typeof url !== "string") return false;
  const raw = url.trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();
  if (lower.startsWith("stream://")) return true;

  // Relative stream endpoint.
  if (/^\/stream\/[^/?#]+\.(mjpg|mjpeg)(\?.*)?$/i.test(raw)) return true;

  // Absolute stream endpoint.
  try {
    const parsed = new URL(raw);
    return /^\/stream\/[^/?#]+\.(mjpg|mjpeg)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

export const normalizeStreamOutputUrl = (url: string) => {
  if (!url || typeof url !== "string") return url;
  const resolveApiOrigin = () => {
    try {
      const configured = new URL(getRestApiUrl());
      if (typeof window === "undefined") return configured.origin;

      const browserHost = window.location.hostname;

      if (browserHost && !isLocalOrAnyHost(browserHost) && isLocalOrAnyHost(configured.hostname)) {
        configured.hostname = browserHost;
      }

      return configured.origin;
    } catch {
      return getRestApiUrl();
    }
  };

  const rewriteBackendMediaUrl = (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl);
      if (!isBackendMediaPath(parsed.pathname)) return rawUrl;

      const apiOrigin = new URL(resolveApiOrigin());
      if (!isLocalOrAnyHost(parsed.hostname)) return rawUrl;

      parsed.protocol = apiOrigin.protocol;
      parsed.hostname = apiOrigin.hostname;
      parsed.port = apiOrigin.port;
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  };

  const absolutizeRelativeBackendMediaUrl = (rawUrl: string) => {
    if (!rawUrl.startsWith("/")) return rawUrl;
    if (!isBackendMediaPath(rawUrl)) return rawUrl;
    return `${resolveApiOrigin()}${rawUrl}`;
  };

  if (url.startsWith("stream://")) {
    const streamId = url.replace("stream://", "");
    return `${resolveApiOrigin()}/stream/${streamId}.mjpg`;
  }
  const rewritten = rewriteBackendMediaUrl(url);
  if (rewritten !== url) return rewritten;
  return absolutizeRelativeBackendMediaUrl(url);
};

const extensionToTypeMap: { [key: string]: OutputType } = {
  // Image extensions
  ".png": "imageUrl",
  ".jpg": "imageUrl",
  ".gif": "imageUrl",
  ".jpeg": "imageUrl",
  ".webp": "imageUrl",
  ".mjpg": "imageUrl",
  ".mjpeg": "imageUrl",
  // Video extensions
  ".mp4": "videoUrl",
  ".mov": "videoUrl",
  // Audio extensions
  ".mp3": "audioUrl",
  ".wav": "audioUrl",
  // 3D extensions
  ".obj": "3dUrl",
  ".glb": "3dUrl",
  // Other extensions
  ".pdf": "fileUrl",
  ".txt": "fileUrl",
};

export function getOutputExtension(output: string): OutputType {
  if (!output) return "markdown";
  if (typeof output !== "string") return "markdown";
  const normalizedOutput = normalizeStreamOutputUrl(output);
  if (isStreamUrl(normalizedOutput)) return "imageUrl";

  let extension = Object.keys(extensionToTypeMap).find((ext) =>
    normalizedOutput.endsWith(ext),
  );

  if (!extension) {
    extension = "." + getFileTypeFromUrl(normalizedOutput);
  }

  return extension ? extensionToTypeMap[extension] : "markdown";
}

export function getFileTypeFromUrl(url: string) {
  const lastDotIndex = url.lastIndexOf(".");
  const urlWithoutParams = url.includes("?")
    ? url.substring(0, url.indexOf("?"))
    : url;
  const fileType = urlWithoutParams.substring(lastDotIndex + 1);
  return fileType;
}
