import client from "./client";

export interface ServerModelFile {
  path: string;
  basename: string;
  extension: string;
  kind: string;
  search_root: string;
}

export interface ServerModelFilesResponse {
  files: ServerModelFile[];
  count: number;
  roots: Array<{
    path: string;
    exists: boolean;
  }>;
}

export async function getServerModelFiles(): Promise<ServerModelFilesResponse> {
  try {
    const response = await client.get("/node/local-model-files");
    return response.data;
  } catch (nodeRouteError: any) {
    // Fallback for older backend builds that only expose the route under /models.
    const status = nodeRouteError?.response?.status;
    if (status != null && status !== 404) {
      throw nodeRouteError;
    }
  }

  const response = await client.get("/models/local-files");
  return response.data;
}
