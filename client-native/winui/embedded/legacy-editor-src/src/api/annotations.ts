import client from "./client";

export type AnnotationStatusFilter = "all" | "done" | "unassigned";

export type AnnotateImageItem = {
  name: string;
  url: string;
  status: AnnotationStatusFilter | "done" | "unassigned";
  label_count: number;
  label_file: string;
  label_updated_at?: number | null;
  annotated_image_file?: string;
  annotated_image_url?: string;
  annotated_image_updated_at?: number | null;
};

export type AnnotateImageListResponse = {
  dataset_id: string;
  dataset_name: string;
  folder_name: string;
  classes: string[];
  status: AnnotationStatusFilter;
  page: number;
  page_size: number;
  total: number;
  stats: {
    all: number;
    done: number;
    unassigned: number;
  };
  images: AnnotateImageItem[];
};

export type AnnotationBox = {
  class_id: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AnnotateImageLabelsResponse = {
  dataset_id: string;
  image_name: string;
  image_url: string;
  label_file: string;
  status: "done" | "unassigned";
  classes: string[];
  boxes: AnnotationBox[];
  updated_at?: number | null;
  annotated_image_file?: string;
  annotated_image_url?: string;
  annotated_image_updated_at?: number | null;
};

export type SaveAnnotationLabelsResponse = {
  dataset_id: string;
  image_name: string;
  saved_count: number;
  status: "done" | "unassigned";
  label_file: string;
  done_marker_file?: string;
  updated_at?: number | null;
  annotated_image_file?: string;
  annotated_image_url?: string;
  annotated_image_updated_at?: number | null;
  render_warning?: string;
};

export type DeleteAnnotationLabelsResponse = {
  dataset_id: string;
  image_name: string;
  label_file: string;
  done_marker_file?: string;
  deleted: boolean;
  done_marker_deleted?: boolean;
  annotated_image_file?: string;
  annotated_image_deleted?: boolean;
};

export type UpdateAnnotationClassesResponse = {
  dataset_id: string;
  classes: string[];
  count: number;
};

export async function listAnnotationImages(
  datasetId: string,
  status: AnnotationStatusFilter = "all",
  page = 1,
  pageSize = 200,
): Promise<AnnotateImageListResponse> {
  const response = await client.get<AnnotateImageListResponse>(
    `/annotate/datasets/${encodeURIComponent(datasetId)}/images`,
    {
      params: {
        status,
        page,
        page_size: pageSize,
      },
    },
  );
  return response.data;
}

export async function getImageAnnotationLabels(
  datasetId: string,
  imageName: string,
): Promise<AnnotateImageLabelsResponse> {
  const response = await client.get<AnnotateImageLabelsResponse>(
    `/annotate/datasets/${encodeURIComponent(datasetId)}/images/${encodeURIComponent(imageName)}/labels`,
  );
  return response.data;
}

export async function saveImageAnnotationLabels(
  datasetId: string,
  imageName: string,
  boxes: AnnotationBox[],
  options?: {
    markDoneOnly?: boolean;
  },
): Promise<SaveAnnotationLabelsResponse> {
  const payload: {
    boxes: AnnotationBox[];
    mark_done_only?: boolean;
  } = { boxes };
  if (options?.markDoneOnly) {
    payload.mark_done_only = true;
  }

  const response = await client.put<SaveAnnotationLabelsResponse>(
    `/annotate/datasets/${encodeURIComponent(datasetId)}/images/${encodeURIComponent(imageName)}/labels`,
    payload,
  );
  return response.data;
}

export async function deleteImageAnnotationLabels(
  datasetId: string,
  imageName: string,
): Promise<DeleteAnnotationLabelsResponse> {
  const response = await client.delete<DeleteAnnotationLabelsResponse>(
    `/annotate/datasets/${encodeURIComponent(datasetId)}/images/${encodeURIComponent(imageName)}/labels`,
  );
  return response.data;
}

export async function updateAnnotationClasses(
  datasetId: string,
  classes: string[],
): Promise<UpdateAnnotationClassesResponse> {
  const response = await client.put<UpdateAnnotationClassesResponse>(
    `/annotate/datasets/${encodeURIComponent(datasetId)}/classes`,
    { classes },
  );
  return response.data;
}
