import type { Node } from "reactflow";
import { resolveBackendBaseUrl } from "../api/client";
import { FlowSocket } from "../sockets/flowSocket";

type CameraConfig = {
  cameraIndex: number;
  width?: number;
  height?: number;
  fps?: number;
};

type Publisher = {
  key: string;
  sessionId: string;
  config: CameraConfig;
  running: boolean;
  inFlightCount: number;
  lastTickAt: number;
  timerId: number | null;
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  avgUploadMs: number;
};

type PrewarmArgs = {
  nodes: Node[];
  socket: FlowSocket | null;
  connect?: () => void;
};

const publishers = new Map<string, Publisher>();

const JPEG_UPLOAD_QUALITY = 0.75;
const MAX_IN_FLIGHT_UPLOADS = 6;
const FRAME_UPLOAD_TIMEOUT_MS = 2000;
const HIDDEN_MEDIA_HOST_ID = "aski-client-camera-host";

function isCameraNode(node: any): boolean {
  const processorType = String(node?.data?.processorType || "").toLowerCase();
  const nodeName = String(node?.data?.name || "").toLowerCase();
  const hasCameraIndex =
    node?.data?.camera_index !== undefined &&
    node?.data?.camera_index !== null &&
    node?.data?.camera_index !== "";
  return (
    processorType === "camera-input" ||
    processorType.includes("camera") ||
    nodeName.endsWith("#camera-input") ||
    hasCameraIndex
  );
}

function toOptionalPositiveInt(value: any): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function toOptionalPositiveNumber(value: any): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function toCameraIndex(value: any): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function toFps(value: any): number | undefined {
  return toOptionalPositiveNumber(value);
}

function normalizeCameraConfig(config: CameraConfig): CameraConfig {
  return {
    cameraIndex: config.cameraIndex,
    width: toOptionalPositiveInt(config.width),
    height: toOptionalPositiveInt(config.height),
    fps: toOptionalPositiveNumber(config.fps),
  };
}

function extractCameraConfigs(nodes: Node[]): CameraConfig[] {
  const byIndex = new Map<number, CameraConfig>();

  nodes.forEach((node) => {
    if (!isCameraNode(node)) return;
    const data: any = node?.data || {};
    const cameraIndex = toCameraIndex(data.camera_index);
    const width = toOptionalPositiveInt(data.width);
    const height = toOptionalPositiveInt(data.height);
    const fps = toFps(data.fps);
    const existing = byIndex.get(cameraIndex);

    if (!existing) {
      byIndex.set(cameraIndex, { cameraIndex, width, height, fps });
      return;
    }

    // Prefer the highest requested quality among nodes sharing the same device.
    byIndex.set(cameraIndex, {
      cameraIndex,
      width: Math.max(existing.width || 0, width || 0) || undefined,
      height: Math.max(existing.height || 0, height || 0) || undefined,
      fps: Math.max(existing.fps || 0, fps || 0) || undefined,
    });
  });

  return Array.from(byIndex.values()).map(normalizeCameraConfig);
}

function buildPublisherKey(sessionId: string, cameraIndex: number): string {
  return `${sessionId}:${cameraIndex}`;
}

// RV-004: resolve the canonical runtime session identifier for camera frame
// uploads so that X-Aski-Client-Session-Id always matches the client_id that
// the backend uses in _resolve_runtime_session_id for the same connection.
//
// Rule:
//   Native desktop mode  → window.askiDesktop.clientId (stable, survives reconnect)
//   Web browser mode     → socket SID resolved by waitForSocketSessionId
async function resolveRuntimeSessionId(
  socket: FlowSocket | null,
  connect?: () => void,
): Promise<string | null> {
  if (typeof window !== "undefined") {
    const clientId = String(window.askiDesktop?.clientId || "").trim();
    if (clientId) {
      // Ensure the socket is up even though we don't need its SID as the key.
      if (socket) {
        try {
          connect?.();
          socket.connect();
        } catch (e) {
          // ignore — socket may already be connected
        }
      } else {
        connect?.();
      }
      return clientId;
    }
  }
  // Web fallback: use the socket SID.
  return waitForSocketSessionId(socket, connect);
}

async function waitForSocketSessionId(
  socket: FlowSocket | null,
  connect?: () => void,
  timeoutMs = 4000,
): Promise<string | null> {
  if (!socket) {
    connect?.();
    return null;
  }

  const existingId = socket.getId();
  if (existingId) return existingId;

  try {
    connect?.();
    socket.connect();
  } catch (error) {
    console.warn("Failed to connect socket before camera prewarm:", error);
  }

  return await new Promise<string | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.off("connect", onConnect);
      } catch (e) {
        // ignore
      }
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    const onConnect = () => {
      finish(socket.getId() || null);
    };

    try {
      socket.on("connect", onConnect);
    } catch (e) {
      finish(null);
      return;
    }

    timer = setTimeout(() => finish(socket.getId() || null), timeoutMs);
  });
}

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      if (timer) clearTimeout(timer);
      resolve();
    };

    const onReady = () => finish();

    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("canplay", onReady, { once: true });
    timer = setTimeout(finish, 1500);
  });
}

async function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_UPLOAD_QUALITY);
  });
}

function ensureHiddenMediaHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(HIDDEN_MEDIA_HOST_ID);
  if (existing) return existing;

  const host = document.createElement("div");
  host.id = HIDDEN_MEDIA_HOST_ID;
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "-10000px";
  host.style.width = "1px";
  host.style.height = "1px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  return host;
}

async function getVideoDeviceIdByIndex(cameraIndex: number): Promise<string | undefined> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.enumerateDevices
  ) {
    return undefined;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((d) => d.kind === "videoinput");
    return videoInputs[cameraIndex]?.deviceId;
  } catch (error) {
    console.warn("Failed to enumerate camera devices:", error);
    return undefined;
  }
}

async function openCameraStream(config: CameraConfig): Promise<MediaStream> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    throw new Error("Browser camera API (getUserMedia) is not available");
  }

  const deviceId = await getVideoDeviceIdByIndex(config.cameraIndex);
  const baseConstraints: MediaTrackConstraints = {
    width: config.width ? { ideal: config.width } : undefined,
    height: config.height ? { ideal: config.height } : undefined,
    frameRate: config.fps ? { ideal: config.fps } : undefined,
  };

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? {
            ...baseConstraints,
            deviceId: { exact: deviceId },
          }
        : baseConstraints,
      audio: false,
    });
  } catch (error) {
    if (!deviceId) throw error;
    // Fallback to default camera when the index mapping is not stable on the OS/browser.
    return await navigator.mediaDevices.getUserMedia({
      video: baseConstraints,
      audio: false,
    });
  }
}

function resolveRuntimeCameraConfig(
  requestedConfig: CameraConfig,
  stream: MediaStream,
  video: HTMLVideoElement,
): CameraConfig {
  const track = stream.getVideoTracks()[0];
  const trackSettings = track?.getSettings?.();

  const sourceWidth =
    toOptionalPositiveInt(trackSettings?.width) || toOptionalPositiveInt(video.videoWidth);
  const sourceHeight =
    toOptionalPositiveInt(trackSettings?.height) || toOptionalPositiveInt(video.videoHeight);
  const sourceFps = toOptionalPositiveNumber(trackSettings?.frameRate);

  const resolvedWidth =
    requestedConfig.width && sourceWidth
      ? Math.max(requestedConfig.width, sourceWidth)
      : requestedConfig.width || sourceWidth;
  const resolvedHeight =
    requestedConfig.height && sourceHeight
      ? Math.max(requestedConfig.height, sourceHeight)
      : requestedConfig.height || sourceHeight;
  const resolvedFps =
    requestedConfig.fps && sourceFps
      ? Math.max(requestedConfig.fps, sourceFps)
      : requestedConfig.fps || sourceFps;

  return {
    cameraIndex: requestedConfig.cameraIndex,
    width: resolvedWidth,
    height: resolvedHeight,
    fps: resolvedFps,
  };
}

async function uploadFrame(publisher: Publisher, blob: Blob): Promise<void> {
  const baseUrl = resolveBackendBaseUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    camera_index: String(publisher.config.cameraIndex),
  });
  if (publisher.config.fps) {
    params.set("fps", String(publisher.config.fps));
  }
  if (publisher.config.width) {
    params.set("width", String(publisher.config.width));
  }
  if (publisher.config.height) {
    params.set("height", String(publisher.config.height));
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  if (controller && FRAME_UPLOAD_TIMEOUT_MS > 0) {
    timeoutId = setTimeout(() => controller.abort(), FRAME_UPLOAD_TIMEOUT_MS);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/stream/client-camera/frame?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Aski-Client-Session-Id": publisher.sessionId,
      },
      body: blob,
      signal: controller?.signal,
    });
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      throw new Error(`Upload timed out after ${FRAME_UPLOAD_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
}

function stopPublisherInternal(publisher: Publisher) {
  publisher.running = false;

  if (publisher.timerId !== null) {
    window.clearInterval(publisher.timerId);
    publisher.timerId = null;
  }

  try {
    publisher.video?.pause();
  } catch (e) {
    // ignore
  }

  try {
    if (publisher.video) {
      (publisher.video as any).srcObject = null;
    }
  } catch (e) {
    // ignore
  }

  try {
    if (publisher.video && publisher.video.parentElement) {
      publisher.video.parentElement.removeChild(publisher.video);
    }
  } catch (e) {
    // ignore
  }

  try {
    publisher.stream?.getTracks().forEach((track) => track.stop());
  } catch (e) {
    // ignore
  }

  publisher.stream = null;
  publisher.video = null;
  publisher.inFlightCount = 0;
}

function startPublisherLoop(publisher: Publisher) {
  const targetFps = publisher.config.fps || 0;
  const intervalMs = targetFps > 0 ? 1000 / Math.max(1, targetFps) : 33;

  const tick = () => {
    if (!publisher.running) return;

    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - publisher.lastTickAt < intervalMs) {
      return;
    }
    publisher.lastTickAt = now;

    if (publisher.inFlightCount >= MAX_IN_FLIGHT_UPLOADS) {
      return;
    }

    const video = publisher.video;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return;
    }

    try {
      const targetWidth = publisher.config.width || video.videoWidth;
      const targetHeight = publisher.config.height || video.videoHeight;

      if (publisher.canvas.width !== targetWidth || publisher.canvas.height !== targetHeight) {
        publisher.canvas.width = targetWidth;
        publisher.canvas.height = targetHeight;
      }

      publisher.ctx?.drawImage(video, 0, 0, targetWidth, targetHeight);

      const startedAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      publisher.inFlightCount += 1;

      void toJpegBlob(publisher.canvas)
        .then((blob) => {
          if (!blob) return;
          return uploadFrame(publisher, blob).then(() => {
            const endedAt =
              typeof performance !== "undefined" ? performance.now() : Date.now();
            const uploadMs = Math.max(0, endedAt - startedAt);
            publisher.avgUploadMs =
              publisher.avgUploadMs > 0
                ? publisher.avgUploadMs * 0.8 + uploadMs * 0.2
                : uploadMs;
          });
        })
        .catch((error) => {
          console.warn(
            `Client camera upload failed (camera_index=${publisher.config.cameraIndex}):`,
            error,
          );
          // Back off quickly when the network/backend is struggling.
          publisher.avgUploadMs = Math.max(publisher.avgUploadMs, 250);
        })
        .finally(() => {
          publisher.inFlightCount = Math.max(0, publisher.inFlightCount - 1);
        });
    } catch (error) {
      console.warn(
        `Client camera upload failed (camera_index=${publisher.config.cameraIndex}):`,
        error,
      );
      publisher.avgUploadMs = Math.max(publisher.avgUploadMs, 250);
      publisher.inFlightCount = Math.max(0, publisher.inFlightCount - 1);
    }
  };

  publisher.timerId = window.setInterval(tick, Math.max(4, Math.floor(intervalMs)));
}

async function startPublisher(sessionId: string, config: CameraConfig): Promise<void> {
  const key = buildPublisherKey(sessionId, config.cameraIndex);
  const existing = publishers.get(key);

  if (
    existing &&
    existing.running &&
    existing.config.width === config.width &&
    existing.config.height === config.height &&
    existing.config.fps === config.fps
  ) {
    return;
  }

  if (existing) {
    stopPublisherInternal(existing);
    publishers.delete(key);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const publisher: Publisher = {
    key,
    sessionId,
    config,
    running: true,
    inFlightCount: 0,
    lastTickAt: 0,
    timerId: null,
    stream: null,
    video: null,
    canvas,
    ctx,
    avgUploadMs: 0,
  };
  publishers.set(key, publisher);

  try {
    const stream = await openCameraStream(config);
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    (video as any).srcObject = stream;
    const hiddenHost = ensureHiddenMediaHost();
    try {
      hiddenHost?.appendChild(video);
    } catch (e) {
      // ignore
    }

    try {
      await video.play();
    } catch (e) {
      // Some browsers auto-play camera streams without explicit play resolution.
    }
    await waitForVideoReady(video);

    if (!publisher.running) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    publisher.config = resolveRuntimeCameraConfig(config, stream, video);
    publisher.stream = stream;
    publisher.video = video;
    startPublisherLoop(publisher);
  } catch (error) {
    stopPublisherInternal(publisher);
    publishers.delete(key);
    throw error;
  }
}

export async function prewarmClientCameraPublishers({
  nodes,
  socket,
  connect,
}: PrewarmArgs): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const cameraConfigs = extractCameraConfigs(nodes);
  if (!cameraConfigs.length) return;

  const sessionId = await resolveRuntimeSessionId(socket, connect);
  if (!sessionId) {
    console.warn("Skipping client camera prewarm because runtime session id is unavailable");
    return;
  }

  for (const config of cameraConfigs) {
    try {
      await startPublisher(sessionId, config);
    } catch (error) {
      console.error(
        `Failed to start client camera publisher (camera_index=${config.cameraIndex}):`,
        error,
      );
    }
  }

  const desiredKeys = new Set(
    cameraConfigs.map((config) => buildPublisherKey(sessionId, config.cameraIndex)),
  );

  for (const [key, publisher] of Array.from(publishers.entries())) {
    // Socket reconnect can change session id; old local publishers must be
    // stopped or the camera remains locked on the client.
    if (publisher.sessionId !== sessionId) {
      stopPublisherInternal(publisher);
      publishers.delete(key);
      continue;
    }
    if (desiredKeys.has(key)) continue;
    stopPublisherInternal(publisher);
    publishers.delete(key);
  }
}

export function stopClientCameraPublisherByIndex(
  cameraIndex: number | string,
  socket?: FlowSocket | null,
) {
  const normalizedIndex = toCameraIndex(cameraIndex);
  const sessionId = socket?.getId();
  let stoppedCount = 0;

  for (const [key, publisher] of Array.from(publishers.entries())) {
    if (publisher.config.cameraIndex !== normalizedIndex) continue;
    if (sessionId && publisher.sessionId !== sessionId) continue;
    stopPublisherInternal(publisher);
    publishers.delete(key);
    stoppedCount += 1;
  }

  // Fallback for socket reconnects: current socket id may differ from the
  // publisher session id that originally opened the camera.
  if (sessionId && stoppedCount === 0) {
    for (const [key, publisher] of Array.from(publishers.entries())) {
      if (publisher.config.cameraIndex !== normalizedIndex) continue;
      stopPublisherInternal(publisher);
      publishers.delete(key);
      stoppedCount += 1;
    }
  }
}

export function stopAllClientCameraPublishers(socket?: FlowSocket | null) {
  const sessionId = socket?.getId();
  let stoppedCount = 0;

  for (const [key, publisher] of Array.from(publishers.entries())) {
    if (sessionId && publisher.sessionId !== sessionId) continue;
    stopPublisherInternal(publisher);
    publishers.delete(key);
    stoppedCount += 1;
  }

  // Fallback after reconnect: release stale publishers from previous socket id.
  if (sessionId && stoppedCount === 0) {
    for (const [key, publisher] of Array.from(publishers.entries())) {
      stopPublisherInternal(publisher);
      publishers.delete(key);
    }
  }
}
