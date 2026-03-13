import apiClient from "./client";

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "operator";
}

export interface Permission {
  permission_key: string;
  label: string;
  description: string;
  is_allowed: boolean;
}

export interface LoginResponse {
  token: string;
  expires_in: number;
  user: AuthUser;
}

export async function loginApi(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const res = await apiClient.post<LoginResponse>("/auth/login", {
    username,
    password,
  });
  return res.data;
}

export async function getMeApi(): Promise<AuthUser> {
  const res = await apiClient.get<AuthUser>("/auth/me");
  return res.data;
}

export async function getPermissionsApi(): Promise<Permission[]> {
  const res = await apiClient.get<Permission[]>("/auth/permissions");
  return res.data;
}

export async function updatePermissionApi(
  key: string,
  isAllowed: boolean,
): Promise<void> {
  await apiClient.put(`/auth/permissions/${key}`, { is_allowed: isAllowed });
}

export interface UserRecord {
  id: number;
  username: string;
  role: "admin" | "operator";
  is_active: boolean;
  created_at: string | null;
  last_login: string | null;
}

export async function listUsersApi(): Promise<UserRecord[]> {
  const res = await apiClient.get<UserRecord[]>("/auth/users");
  return res.data;
}

export async function createUserApi(
  username: string,
  password: string,
  role: "admin" | "operator",
): Promise<{ id: number; username: string; role: string }> {
  const res = await apiClient.post("/auth/users", { username, password, role });
  return res.data;
}

export async function updateUserActiveApi(
  userId: number,
  isActive: boolean,
): Promise<void> {
  await apiClient.put(`/auth/users/${userId}`, { is_active: isActive });
}
