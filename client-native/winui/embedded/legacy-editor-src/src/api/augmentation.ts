import client from "./client";

export type AugmentationTechnique = {
  id: string;
  label: string;
  description: string;
  group: "geometric" | "color" | "noise";
};

export type AugmentationJob = {
  id: string;
  dataset_id: string;
  techniques: string[];
  copies_per_technique: number;
  seed: number;
  status: "queued" | "running" | "canceling" | "canceled" | "completed" | "failed";
  total: number;
  progress: number;
  generated: number;
  errors: number;
  error: string | null;
  created_at: number | null;
  started_at: number | null;
  finished_at: number | null;
};

export async function listAugmentationTechniques(): Promise<AugmentationTechnique[]> {
  const response = await client.get<AugmentationTechnique[]>("/augment/techniques");
  return response.data || [];
}

export async function createAugmentationJob(payload: {
  dataset_id: string;
  techniques: string[];
  copies_per_technique?: number;
  seed?: number;
}): Promise<AugmentationJob> {
  const response = await client.post<AugmentationJob>("/augment/jobs", payload);
  return response.data;
}

export async function listAugmentationJobs(): Promise<AugmentationJob[]> {
  const response = await client.get<AugmentationJob[]>("/augment/jobs");
  return response.data || [];
}

export async function getAugmentationJob(jobId: string): Promise<AugmentationJob> {
  const response = await client.get<AugmentationJob>(
    `/augment/jobs/${encodeURIComponent(jobId)}`,
  );
  return response.data;
}

export async function cancelAugmentationJob(jobId: string): Promise<AugmentationJob> {
  const response = await client.post<AugmentationJob>(
    `/augment/jobs/${encodeURIComponent(jobId)}/cancel`,
  );
  return response.data;
}

export async function deleteAugmentationJob(jobId: string): Promise<{ id: string; deleted: boolean }> {
  const response = await client.delete<{ id: string; deleted: boolean }>(
    `/augment/jobs/${encodeURIComponent(jobId)}`,
  );
  return response.data;
}
