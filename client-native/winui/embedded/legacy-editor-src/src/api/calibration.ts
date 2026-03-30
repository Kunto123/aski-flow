import apiClient from "./client";

// ── Color Profile Contract ────────────────────────────────────────────────────
export interface ColorProfileRgb {
  r: number;
  g: number;
  b: number;
}

export interface ColorProfileReferenceColor {
  hex: string;
  rgb: ColorProfileRgb;
}

export interface ColorProfileStats {
  mean: Record<string, number>;  // {l,a,b} or {r,g,b}
  std:  Record<string, number>;
}

export interface ColorProfile {
  schema_version:   number;
  method:           string;
  colorspace:       "LAB" | "RGB";
  reference_source: string;
  reference_color:  ColorProfileReferenceColor;
  reference_stats:  ColorProfileStats;
  tolerance: {
    distance_threshold: number;
  };
  min_match_ratio: number;
  sampling_meta: {
    width:        number;
    height:       number;
    total_pixels: number;
  };
}

// ── Request payloads ──────────────────────────────────────────────────────────
export interface ComputeColorProfileByImageData {
  image_data: string;          // base64-encoded PNG/JPEG
  colorspace?: "LAB" | "RGB";
  roi?: { x: number; y: number; w: number; h: number }; // normalised [0,1]
}

export interface ComputeColorProfileByUrl {
  image_url: string;           // /asset/<filename>
  colorspace?: "LAB" | "RGB";
  roi?: { x: number; y: number; w: number; h: number };
}

export type ComputeColorProfilePayload =
  | ComputeColorProfileByImageData
  | ComputeColorProfileByUrl;

// ── API call — compute ────────────────────────────────────────────────────────
export async function computeColorProfile(
  payload: ComputeColorProfilePayload,
): Promise<ColorProfile> {
  const response = await apiClient.post<ColorProfile>(
    "/calibration/color-profile",
    payload,
  );
  return response.data;
}

// ── Color Profile Registry ────────────────────────────────────────────────────

export interface ColorProfileRecord {
  id: number;
  name: string;
  profile: ColorProfile;
  created_at: number;
}

export interface SaveColorProfilePayload {
  name: string;
  profile: ColorProfile;
}

export async function listColorProfiles(): Promise<ColorProfileRecord[]> {
  const response = await apiClient.get<ColorProfileRecord[]>("/calibration/profiles");
  return response.data;
}

export async function saveColorProfile(
  payload: SaveColorProfilePayload,
): Promise<ColorProfileRecord> {
  const response = await apiClient.post<ColorProfileRecord>("/calibration/profiles", payload);
  return response.data;
}

export async function deleteColorProfile(id: number): Promise<void> {
  await apiClient.delete(`/calibration/profiles/${id}`);
}
