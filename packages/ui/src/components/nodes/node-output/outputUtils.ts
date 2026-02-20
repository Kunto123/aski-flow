import { OutputType } from "../../../nodes-configuration/types";
import { getRestApiUrl } from "../../../config/config";

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
      const isLocalHost = (host: string) =>
        host === "localhost" || host === "127.0.0.1" || host === "::1";

      if (browserHost && !isLocalHost(browserHost) && isLocalHost(configured.hostname)) {
        configured.hostname = browserHost;
      }

      return configured.origin;
    } catch {
      return getRestApiUrl();
    }
  };

  const rewriteLocalhostStreamUrl = (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.pathname.includes("/stream/")) return rawUrl;
      if (typeof window === "undefined") return rawUrl;

      const browserHost = window.location.hostname;
      const isLocalHost = (host: string) =>
        host === "localhost" || host === "127.0.0.1" || host === "::1";

      if (
        browserHost &&
        !isLocalHost(browserHost) &&
        isLocalHost(parsed.hostname)
      ) {
        parsed.hostname = browserHost;
        return parsed.toString();
      }
    } catch {
      return rawUrl;
    }

    return rawUrl;
  };

  if (url.startsWith("stream://")) {
    const streamId = url.replace("stream://", "");
    return `${resolveApiOrigin()}/stream/${streamId}.mjpg`;
  }
  return rewriteLocalhostStreamUrl(url);
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
