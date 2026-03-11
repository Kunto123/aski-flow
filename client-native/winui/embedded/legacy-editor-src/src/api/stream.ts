import client from "./client";

export async function stopStream(streamId: string): Promise<boolean> {
  if (!streamId) return false;
  try {
    await client.post(`/stream/${streamId}/stop`);
    return true;
  } catch (error) {
    console.error("Failed to stop stream:", streamId, error);
    return false;
  }
}

export async function stopStreamsByOwner(nodeName: string): Promise<boolean> {
  if (!nodeName) return false;
  try {
    const encoded = encodeURIComponent(nodeName);
    const response = await client.post(`/stream/owner/${encoded}/stop`);
    return !!response?.data?.stopped;
  } catch (error) {
    console.error("Failed to stop streams for owner:", nodeName, error);
    return false;
  }
}

export async function stopAllCameraStreams(
  clientSessionId?: string,
): Promise<boolean> {
  try {
    const response = await client.post("/stream/camera/stop", {
      client_session_id: clientSessionId,
    });
    return !!response?.data?.stopped;
  } catch (error) {
    console.error("Failed to stop all camera streams:", error);
    return false;
  }
}

export async function stopCameraStreamsByIndex(
  cameraIndex: number | string,
  clientSessionId?: string,
): Promise<boolean> {
  if (cameraIndex === undefined || cameraIndex === null || cameraIndex === "") {
    return false;
  }
  try {
    const response = await client.post("/stream/camera/by-index/stop", {
      camera_index: Number(cameraIndex),
      client_session_id: clientSessionId,
    });
    return !!response?.data?.stopped;
  } catch (error) {
    console.error(
      "Failed to stop camera streams by index:",
      cameraIndex,
      error,
    );
    return false;
  }
}

export async function updateRoiStreamParams(
  streamId: string,
  params: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    width?: number;
    height?: number;
  },
): Promise<boolean> {
  if (!streamId) return false;
  try {
    const response = await client.post(`/stream/${streamId}/roi/params`, params);
    return !!response?.data?.updated;
  } catch (error) {
    console.error("Failed to update ROI stream params:", streamId, error);
    return false;
  }
}
