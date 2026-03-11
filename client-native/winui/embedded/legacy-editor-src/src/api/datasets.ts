import client from "./client";

export type DatasetSummary = {
  id: string;
  name: string;
  path: string;
  folder_name: string;
  classes: string[];
  classes_json?: string;
  created_at?: number;
  stats?: {
    images: number;
    labels: number;
    videos: number;
  };
};

export type DatasetFileItem = {
  name: string;
  original_name?: string;
  target: "images" | "labels" | "videos" | "splits" | "exports";
  size_bytes: number;
  url: string;
};

export type DatasetUploadTarget =
  | "images"
  | "labels"
  | "videos"
  | "splits"
  | "exports";

export type DatasetUploadKind = "image" | "video" | "file" | "dll";

export type DatasetFilesResponse = {
  dataset_id: string;
  target: string;
  count: number;
  files: DatasetFileItem[];
};

export type DatasetUploadResponse = {
  dataset_id: string;
  target: string;
  saved_count: number;
  files: DatasetFileItem[];
};

export type DatasetDeleteResponse = {
  id: string;
  deleted: boolean;
};

export type DatasetDeleteFilesResponse = {
  dataset_id: string;
  target: string;
  requested_count: number;
  deleted_count: number;
  deleted: string[];
  missing: string[];
  errors: Array<{
    name: string;
    error: string;
  }>;
};

export async function listDatasets(): Promise<DatasetSummary[]> {
  const response = await client.get<DatasetSummary[]>("/datasets");
  return response.data || [];
}

export async function createDataset(payload: {
  name: string;
  id?: string;
  folder_name?: string;
  classes?: string[];
}): Promise<DatasetSummary> {
  const response = await client.post<DatasetSummary>("/datasets", payload);
  return response.data;
}

export async function listDatasetFiles(
  datasetId: string,
  target: DatasetUploadTarget = "images",
): Promise<DatasetFilesResponse> {
  const response = await client.get<DatasetFilesResponse>(
    `/datasets/${encodeURIComponent(datasetId)}/files`,
    {
      params: { target },
    },
  );
  return response.data;
}

export async function uploadDatasetFiles(
  datasetId: string,
  files: File[],
  target: DatasetUploadTarget = "images",
  uploadKind?: DatasetUploadKind,
): Promise<DatasetUploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("file", file));
  formData.append("target", target);
  if (uploadKind) {
    formData.append("upload_kind", uploadKind);
  }

  const response = await client.post<DatasetUploadResponse>(
    `/datasets/${encodeURIComponent(datasetId)}/upload`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );

  return response.data;
}

export async function deleteDataset(
  datasetId: string,
): Promise<DatasetDeleteResponse> {
  const response = await client.delete<DatasetDeleteResponse>(
    `/datasets/${encodeURIComponent(datasetId)}`,
  );
  return response.data;
}

export async function deleteDatasetFiles(
  datasetId: string,
  target: DatasetUploadTarget,
  names: string[],
): Promise<DatasetDeleteFilesResponse> {
  const response = await client.delete<DatasetDeleteFilesResponse>(
    `/datasets/${encodeURIComponent(datasetId)}/files`,
    {
      data: {
        target,
        names,
      },
    },
  );
  return response.data;
}

