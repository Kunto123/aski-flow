import type { Node } from "reactflow";
import { resolveBackendBaseUrl } from "../api/client";
import { FlowSocket } from "../sockets/flowSocket";

type CameraConfig = {
  cameraIndex: number;
  width?: number;
  height?: number;
  fps: number;
};

type Publisher = {
  key: string;
  sessionId: string;
  config: CameraConfig;
  running: boolean;
  inFlight: boolean;
  lastTickAt: number;
  rafId: number | null;
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

function toCameraIndex(value: any): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function toFps(value: any): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.max(1, Math.min(30, parsed));
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
      fps: Math.max(existing.fps || 0, fps || 0) || 10,
    });
  });

  return Array.from(byIndex.values());
}

function buildPublisherKey(sessionId: string, cameraIndex: number): string {
  return `${sessionId}:${cameraIndex}`;
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
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.75);
  });
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
    frameRate: config.fps ? { ideal: config.fps, max: Math.max(config.fps, 1) } : undefined,
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

async function uploadFrame(publisher: Publisher, blob: Blob): Promise<void> {
  const baseUrl = resolveBackendBaseUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    camera_index: String(publisher.config.cameraIndex),
    fps: String(publisher.config.fps),
  });
  if (publisher.config.width) {
    params.set("width", String(publisher.config.width));
  }
  if (publisher.config.height) {
    params.set("height", String(publisher.config.height));
  }

  const response = await fetch(`${baseUrl}/stream/client-camera/frame?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "X-Aski-Client-Session-Id": publisher.sessionId,
    },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
}

function stopPublisherInternal(publisher: Publisher) {
  publisher.running = false;

  if (publisher.rafId !== null) {
    cancelAnimationFrame(publisher.rafId);
    publisher.rafId = null;
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
    publisher.stream?.getTracks().forEach((track) => track.stop());
  } catch (e) {
    // ignore
  }

  publisher.stream = null;
  publisher.video = null;
}

function startPublisherLoop(publisher: Publisher) {
  const tick = async (ts: number) => {
    if (!publisher.running) return;

    const baseIntervalMs = 1000 / Math.max(1, publisher.config.fps || 10);
    const adaptiveIntervalMs = Math.max(
      baseIntervalMs,
      publisher.avgUploadMs > 0 ? Math.min(300, publisher.avgUploadMs * 0.9) : 0,
    );
    const hiddenMultiplier =
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? 4
        : 1;
    const intervalMs = adaptiveIntervalMs * hiddenMultiplier;
    if (publisher.inFlight || ts - publisher.lastTickAt < intervalMs) {
      publisher.rafId = requestAnimationFrame(tick);
      return;
    }

    const video = publisher.video;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      publisher.rafId = requestAnimationFrame(tick);
      return;
    }

    publisher.lastTickAt = ts;
    publisher.inFlight = true;

    try {
      const startedAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const targetWidth = publisher.config.width || video.videoWidth;
      const targetHeight = publisher.config.height || video.videoHeight;

      if (publisher.canvas.width !== targetWidth || publisher.canvas.height !== targetHeight) {
        publisher.canvas.width = targetWidth;
        publisher.canvas.height = targetHeight;
      }

      publisher.ctx?.drawImage(video, 0, 0, targetWidth, targetHeight);
      const blob = await toJpegBlob(publisher.canvas);
      if (blob) {
        await uploadFrame(publisher, blob);
      }
      const endedAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const uploadMs = Math.max(0, endedAt - startedAt);
      publisher.avgUploadMs =
        publisher.avgUploadMs > 0
          ? publisher.avgUploadMs * 0.8 + uploadMs * 0.2
          : uploadMs;
    } catch (error) {
      console.warn(
        `Client camera upload failed (camera_index=${publisher.config.cameraIndex}):`,
        error,
      );
      // Back off quickly when the network/backend is struggling.
      publisher.avgUploadMs = Math.max(publisher.avgUploadMs, 250);
    } finally {
      publisher.inFlight = false;
      if (publisher.running) {
        publisher.rafId = requestAnimationFrame(tick);
      }
    }
  };

  publisher.rafId = requestAnimationFrame(tick);
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
    inFlight: false,
    lastTickAt: 0,
    rafId: null,
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

  const sessionId = await waitForSocketSessionId(socket, connect);
  if (!sessionId) {
    console.warn("Skipping client camera prewarm because socket session id is unavailable");
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
