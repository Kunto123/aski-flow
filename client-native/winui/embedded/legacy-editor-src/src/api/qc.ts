/**
 * QC domain API client.
 *
 * Covers:
 *  - Template deployments (per line/station)
 *  - Inspection results & push queue
 *  - Dashboard aggregates
 */

import apiClient from "./client";

// ── Deployments ──────────────────────────────────────────────────────────────

export interface TemplateDeployment {
  id: number;
  template_id: number;
  template_version_id: number;
  line_id: string;
  station_id: string;
  is_active: boolean;
  deployed_by: number | null;
  effective_from: string | null;
  effective_until: string | null;
  created_at: string | null;
  template_name: string;
  version_number: number;
}

export interface DeployTemplatePayload {
  template_id: number;
  template_version_id: number;
  line_id: string;
  station_id: string;
}

export async function deployTemplate(
  payload: DeployTemplatePayload,
): Promise<TemplateDeployment> {
  const response = await apiClient.post<TemplateDeployment>("/deployments", payload);
  return response.data;
}

export async function listDeployments(options?: {
  line_id?: string;
  active_only?: boolean;
}): Promise<TemplateDeployment[]> {
  const response = await apiClient.get<TemplateDeployment[]>("/deployments", {
    params: {
      line_id: options?.line_id,
      active_only: options?.active_only ? "1" : undefined,
    },
  });
  return response.data;
}

export async function getActiveDeployment(
  line_id: string,
  station_id: string,
): Promise<TemplateDeployment | null> {
  const response = await apiClient.get<TemplateDeployment | null>(
    "/deployments/active",
    { params: { line_id, station_id } },
  );
  // Backend returns { deployment: null } or deployment object
  const data = response.data as any;
  if (data && typeof data === "object" && "deployment" in data) {
    return data.deployment;
  }
  return data ?? null;
}

export async function deactivateDeployment(deploymentId: number): Promise<void> {
  await apiClient.delete(`/deployments/${deploymentId}`);
}

// ── Inspection Results ───────────────────────────────────────────────────────

/** Per-target detail; included in InspectionResult.targets when fetching a single result. */
export interface InspectionTarget {
  [key: string]: unknown;
}

/** Flat inspection result row from aski_inspection_results. */
export interface InspectionResult {
  id: number;
  template_version_id: number | null;
  line_id: string | null;
  part_name: string | null;
  mp_check: string | null;
  data1: number | null;
  data2: number | null;
  decision: string;
  decision_code: string;
  reject_reason_code: string | null;
  push_status: "pending" | "sent" | "failed";
  retry_count: number;
  operator_user_id: number | null;
  inspected_at: string | null;
  /** Only present when fetching a single result (GET /inspections/<id>) */
  targets?: InspectionTarget[];
}

export interface ListInspectionResultsOptions {
  line_id?: string;
  part_name?: string;
  template_version_id?: number;
  decision_code?: string;
  push_status?: string;
  from_dt?: string;
  to_dt?: string;
  limit?: number;
  offset?: number;
}

export async function listInspectionResults(
  options?: ListInspectionResultsOptions,
): Promise<InspectionResult[]> {
  const response = await apiClient.get<InspectionResult[]>("/inspections", {
    params: options,
  });
  return response.data;
}

export async function getInspectionResult(resultId: number): Promise<InspectionResult> {
  const response = await apiClient.get<InspectionResult>(`/inspections/${resultId}`);
  return response.data;
}

// Backward-compat aliases
/** @deprecated Use listInspectionResults */
export const listInspectionEvents = listInspectionResults;
/** @deprecated Use getInspectionResult */
export const getInspectionEvent = getInspectionResult;

// ── Push Queue ───────────────────────────────────────────────────────────────

/** Inspection result pending push to external system. */
export interface PushQueueRow {
  id: number;
  template_version_id: number | null;
  line_id: string | null;
  part_name: string | null;
  mp_check: string | null;
  data1: number | null;
  data2: number | null;
  line: string | null;
  decision: string;
  decision_code: string;
  reject_reason_code: string | null;
  targets_json: string | null;
  push_status: "pending" | "sent" | "failed";
  retry_count: number;
  last_error: string | null;
  date_check_mc: string | null;
  created_at: string | null;
}

export async function listPushPending(limit?: number): Promise<PushQueueRow[]> {
  const response = await apiClient.get<PushQueueRow[]>("/inspections/push-pending", {
    params: limit ? { limit } : undefined,
  });
  return response.data;
}

export async function markPushSent(resultId: number): Promise<void> {
  await apiClient.post(`/inspections/push/${resultId}/sent`);
}

export async function markPushFailed(resultId: number, error: string): Promise<void> {
  await apiClient.post(`/inspections/push/${resultId}/failed`, { error });
}

// Legacy outbox aliases (backward compat — routes still respond)
/** @deprecated Use listPushPending */
export const listOutboxPending = listPushPending;
/** @deprecated Use markPushSent */
export const markOutboxSent = markPushSent;
/** @deprecated Use markPushFailed */
export const markOutboxFailed = markPushFailed;

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  total_inspections: number;
  total_accept: number;
  total_reject: number;
  reject_not_found: number;
  reject_wrong_type: number;
  reject_out_of_position: number;
  reject_out_of_angle: number;
  reject_low_conf: number;
  reject_other: number;
}

export interface CounterBucket {
  bucket_time: string;
  granularity: string;
  line_id: string;
  template_version_id: number | null;
  part_name: string | null;
  total_inspections: number;
  total_accept: number;
  total_reject: number;
  reject_not_found: number;
  reject_wrong_type: number;
  reject_out_of_position: number;
  reject_out_of_angle: number;
  reject_low_conf: number;
  reject_other: number;
}

export interface DashboardQueryOptions {
  line_id?: string;
  template_version_id?: number;
  part_name?: string;
  granularity?: "minute" | "hour" | "day";
  from_dt?: string;
  to_dt?: string;
  limit?: number;
}

export async function getDashboardSummary(options?: {
  line_id?: string;
  from_dt?: string;
  to_dt?: string;
}): Promise<DashboardSummary> {
  const response = await apiClient.get<DashboardSummary>("/dashboard/summary", {
    params: options,
  });
  return response.data;
}

export async function getDashboardBuckets(
  options?: DashboardQueryOptions,
): Promise<CounterBucket[]> {
  const response = await apiClient.get<CounterBucket[]>("/dashboard/buckets", {
    params: options,
  });
  return response.data;
}

