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

export type LocalModelFileMutationResponse = {
  file: ServerModelFile & {
    size_bytes?: number;
  };
};

export type LocalModelUploadResponse = {
  saved_count: number;
  files: Array<
    ServerModelFile & {
      size_bytes?: number;
    }
  >;
  errors?: Array<{
    name: string;
    error: string;
  }>;
};

export async function uploadServerModelFiles(
  files: File[],
): Promise<LocalModelUploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("file", file));
  const response = await client.post<LocalModelUploadResponse>(
    "/models/local-files/upload",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );
  return response.data;
}

export async function renameServerModelFile(
  path: string,
  newName: string,
): Promise<LocalModelFileMutationResponse> {
  const response = await client.patch<LocalModelFileMutationResponse>(
    "/models/local-files/rename",
    {
      path,
      new_name: newName,
    },
  );
  return response.data;
}

export async function deleteServerModelFile(path: string): Promise<{
  deleted: boolean;
  path: string;
}> {
  const response = await client.delete("/models/local-files/delete", {
    data: { path },
  });
  return response.data;
}
