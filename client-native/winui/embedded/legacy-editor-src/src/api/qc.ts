/**
 * QC domain API client.
 *
 * Covers:
 *  - Template deployments (per line/station)
 *  - Inspection events & outbox
 *  - Dashboard aggregates
 *  - RBAC role assignment
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

// ── Inspection Events ────────────────────────────────────────────────────────

export interface InspectionTargetResult {
  id: number;
  event_id: number;
  target_id: string | null;
  part_name: string | null;
  expected_class: string | null;
  detected_class: string | null;
  decision: string;
  decision_code: string;
  reject_reason_code: string | null;
  data1: number | null;
  data2: number | null;
  pos_x: number | null;
  pos_y: number | null;
  offset_x: number | null;
  offset_y: number | null;
  angle_deg: number | null;
  delta_angle_deg: number | null;
}

export interface InspectionEvent {
  id: number;
  deployment_id: number | null;
  template_version_id: number | null;
  line_id: string | null;
  station_id: string | null;
  part_name: string | null;
  decision: string;
  decision_code: string;
  reject_reason_code: string | null;
  mp_check: string | null;
  operator_id: number | null;
  inspected_at: string | null;
  targets?: InspectionTargetResult[];
}

export interface ListInspectionEventsOptions {
  line_id?: string;
  part_name?: string;
  template_version_id?: number;
  decision_code?: string;
  from_dt?: string;
  to_dt?: string;
  limit?: number;
  offset?: number;
}

export async function listInspectionEvents(
  options?: ListInspectionEventsOptions,
): Promise<InspectionEvent[]> {
  const response = await apiClient.get<InspectionEvent[]>("/inspections", {
    params: options,
  });
  return response.data;
}

export async function getInspectionEvent(eventId: number): Promise<InspectionEvent> {
  const response = await apiClient.get<InspectionEvent>(`/inspections/${eventId}`);
  return response.data;
}

// ── Outbox ───────────────────────────────────────────────────────────────────

export interface OutboxRow {
  id: number;
  event_id: number | null;
  part_name: string | null;
  date_check_mc: string;
  mp_check: string | null;
  data1: number | null;
  data2: number | null;
  line: string | null;
  decision: string;
  decision_code: string;
  payload_json: string | null;
  status: "pending" | "processing" | "sent" | "failed";
  retry_count: number;
  last_error: string | null;
  created_at: string;
}

export async function listOutboxPending(limit?: number): Promise<OutboxRow[]> {
  const response = await apiClient.get<OutboxRow[]>("/inspections/outbox", {
    params: limit ? { limit } : undefined,
  });
  return response.data;
}

export async function markOutboxSent(outboxId: number): Promise<void> {
  await apiClient.post(`/inspections/outbox/${outboxId}/sent`);
}

export async function markOutboxFailed(outboxId: number, error: string): Promise<void> {
  await apiClient.post(`/inspections/outbox/${outboxId}/failed`, { error });
}

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
  id: number;
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

// ── RBAC ─────────────────────────────────────────────────────────────────────

export interface AskiRole {
  id: number;
  name: string;
  label: string;
  description: string | null;
}

export async function listRoles(): Promise<AskiRole[]> {
  const response = await apiClient.get<AskiRole[]>("/rbac/roles");
  return response.data;
}

export async function listUserRoles(userId: number): Promise<string[]> {
  const response = await apiClient.get<string[]>(`/rbac/users/${userId}/roles`);
  return response.data;
}

export async function assignUserRole(userId: number, roleName: string): Promise<void> {
  await apiClient.post(`/rbac/users/${userId}/roles`, { role_name: roleName });
}

export async function revokeUserRole(userId: number, roleName: string): Promise<void> {
  await apiClient.delete(`/rbac/users/${userId}/roles/${roleName}`);
}

export async function getMyPermissions(): Promise<string[]> {
  const response = await apiClient.get<string[]>("/rbac/me/permissions");
  return response.data;
}
