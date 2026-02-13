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
