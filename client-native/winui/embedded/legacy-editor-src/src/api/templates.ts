import apiClient from "./client";

export interface FlowTemplateNodePolicy {
  editableFields: string[];
}

export interface FlowTemplatePolicy {
  graphLocked: boolean;
  nodes: Record<string, FlowTemplateNodePolicy>;
}

export interface FlowTemplateSummary {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by?: number | null;
  updated_by?: number | null;
  created_at: string | null;
  updated_at: string | null;
  version_id: number | null;
  version_number: number | null;
  version_created_at: string | null;
}

// ── Inspection Recipe ────────────────────────────────────────────────────────

export interface InspectionRecipeTarget {
  target_id: string;
  part_name?: string | null;
  expected_class?: string | null;
  roi_node_name?: string | null;
  min_roi_confidence?: number | null;
  min_class_confidence?: number | null;
  max_offset_x?: number | null;
  max_offset_y?: number | null;
  max_angle_deg?: number | null;
  expected_cx?: number | null;
  expected_cy?: number | null;
  expected_angle_deg?: number | null;
}

export interface InspectionRecipe {
  part_name?: string | null;
  targets: InspectionRecipeTarget[];
}

export interface FlowTemplateDetail extends FlowTemplateSummary {
  flow: any[];
  policy: FlowTemplatePolicy;
  inspection_recipe?: InspectionRecipe | null;
}

export interface SaveFlowTemplatePayload {
  name: string;
  description?: string;
  flow: any[];
  policy: FlowTemplatePolicy;
  inspection_recipe?: InspectionRecipe | null;
}

export async function listFlowTemplates(options?: {
  includeInactive?: boolean;
}): Promise<FlowTemplateSummary[]> {
  const response = await apiClient.get<FlowTemplateSummary[]>("/templates", {
    params: options?.includeInactive ? { include_inactive: "1" } : undefined,
  });
  return response.data;
}

export async function getFlowTemplate(templateId: number): Promise<FlowTemplateDetail> {
  const response = await apiClient.get<FlowTemplateDetail>(`/templates/${templateId}`);
  return response.data;
}

export async function createFlowTemplate(
  payload: SaveFlowTemplatePayload,
): Promise<FlowTemplateDetail> {
  const response = await apiClient.post<FlowTemplateDetail>("/templates", payload);
  return response.data;
}

export async function updateFlowTemplate(
  templateId: number,
  payload: Partial<SaveFlowTemplatePayload> & {
    is_active?: boolean;
  },
): Promise<FlowTemplateDetail> {
  const response = await apiClient.put<FlowTemplateDetail>(
    `/templates/${templateId}`,
    payload,
  );
  return response.data;
}
