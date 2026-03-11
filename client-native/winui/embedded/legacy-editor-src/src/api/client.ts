import axios from "axios";
import { getRestApiUrl } from "../config/config";

export function resolveBackendBaseUrl(): string {
  const configured = getRestApiUrl();

  if (typeof window === "undefined") {
    return configured;
  }

  try {
    const url = new URL(configured);
    const browserHost = window.location.hostname;
    const isLocalOrAnyHost = (host: string) =>
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host === "::" ||
      host === "[::]";

    // If the UI is opened via LAN IP/hostname but the backend is configured with localhost,
    // rewrite requests to the same host so REST calls (e.g., stop camera) work from other devices.
    if (
      browserHost &&
      !isLocalOrAnyHost(browserHost) &&
      isLocalOrAnyHost(url.hostname)
    ) {
      url.hostname = browserHost;
      return url.toString().replace(/\/$/, "");
    }
  } catch (e) {
    // ignore
  }

  return configured;
}

const apiClient = axios.create({
  baseURL: resolveBackendBaseUrl(),
  headers: {
    "Content-type": "application/json",
  },
});

export default apiClient;
