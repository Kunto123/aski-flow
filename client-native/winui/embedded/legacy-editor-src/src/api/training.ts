import client from "./client";

export type TrainingArchitectureItem = {
  id: string;
  family: string;
  label: string;
  available: boolean;
  base_model_path: string;
};

export type TrainingArchitecturesResponse = {
  family: string;
  default_variant: string;
  default_train_params?: {
    epochs?: number;
    imgsz?: number;
    batch?: number;
    patience?: number;
  };
  items: TrainingArchitectureItem[];
};

export type TrainingJob = {
  id: string;
  dataset_id: string;
  base_model: string;
  status:
    | "queued"
    | "running"
    | "canceling"
    | "canceled"
    | "completed"
    | "failed"
    | string;
  log_path: string;
  output_model_id?: string | null;
  architecture_family?: string | null;
  architecture_variant?: string | null;
  trained_model_path?: string | null;
  params_json?: string | null;
  params?: Record<string, any>;
  started_at?: number | null;
  finished_at?: number | null;
  error_message?: string | null;
  created_at?: number;
  is_active?: boolean;
  log_exists?: boolean;
  log_tail?: string;
};

export type TrainingJobLogResponse = {
  id: string;
  log_path: string;
  tail: string;
};

export type TrainingJobDeleteResponse = {
  id: string;
  deleted: boolean;
  status_before_delete: string;
  delete_model: boolean;
  trained_model_deleted: boolean;
  run_artifacts_deleted: boolean;
};

export async function listTrainingArchitectures(): Promise<TrainingArchitecturesResponse> {
  const response = await client.get<TrainingArchitecturesResponse>(
    "/train/architectures",
  );
  return response.data;
}

export async function listTrainingJobs(limit = 50): Promise<TrainingJob[]> {
  const response = await client.get<TrainingJob[]>("/train/jobs", {
    params: { limit },
  });
  return response.data || [];
}

export async function createTrainingJob(payload: {
  dataset_id: string;
  architecture_variant: string;
  epochs: number;
  imgsz: number;
  batch: number;
  patience?: number;
  val_split?: number;
  seed?: number;
  device?: string;
  run_name?: string;
}): Promise<TrainingJob> {
  const response = await client.post<TrainingJob>("/train/jobs", payload);
  return response.data;
}

export async function getTrainingJobLog(
  jobId: string,
  tail = 120,
): Promise<TrainingJobLogResponse> {
  const response = await client.get<TrainingJobLogResponse>(
    `/train/jobs/${encodeURIComponent(jobId)}/log`,
    {
      params: { tail },
    },
  );
  return response.data;
}

export async function cancelTrainingJob(jobId: string): Promise<TrainingJob> {
  const response = await client.post<TrainingJob>(
    `/train/jobs/${encodeURIComponent(jobId)}/cancel`,
  );
  return response.data;
}

export async function deleteTrainingJob(
  jobId: string,
  deleteModel = false,
): Promise<TrainingJobDeleteResponse> {
  const response = await client.delete<TrainingJobDeleteResponse>(
    `/train/jobs/${encodeURIComponent(jobId)}`,
    {
      params: {
        delete_model: deleteModel ? "1" : "0",
      },
    },
  );
  return response.data;
}
