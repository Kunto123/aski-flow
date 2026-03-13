/**
 * PermissionsManager
 *
 * Panel khusus Admin untuk:
 *  1. Toggle permission yang diizinkan untuk Operator
 *  2. Buat akun user baru (Admin / Operator)
 *  3. Aktifkan / nonaktifkan akun
 *
 * Dibuka via tombol "Permissions" di header (hanya tampil untuk Admin).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Permission,
  UserRecord,
  createUserApi,
  listUsersApi,
  updatePermissionApi,
  updateUserActiveApi,
} from "../../api/auth";
import { useAuth } from "../../providers/AuthProvider";

interface Props {
  onClose: () => void;
}

type Tab = "permissions" | "users";

const PermissionsManager: React.FC<Props> = ({ onClose }) => {
  const { permissions, refreshPermissions } = useAuth();
  const [tab, setTab] = useState<Tab>("permissions");

  // ---- Permissions state ----
  const [localPerms, setLocalPerms] = useState<Permission[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  // ---- Users state ----
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "operator">("operator");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Sync dari context
  useEffect(() => {
    setLocalPerms(permissions);
  }, [permissions]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      setUsers(await listUsersApi());
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "users") loadUsers();
  }, [tab, loadUsers]);

  // Toggle permission
  const handleToggle = async (key: string, current: boolean) => {
    setSaving(key);
    try {
      await updatePermissionApi(key, !current);
      setLocalPerms((prev) =>
        prev.map((p) =>
          p.permission_key === key ? { ...p, is_allowed: !current } : p,
        ),
      );
      await refreshPermissions();
    } finally {
      setSaving(null);
    }
  };

  // Toggle user active
  const handleToggleUser = async (userId: number, current: boolean) => {
    await updateUserActiveApi(userId, !current);
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, is_active: !current } : u,
      ),
    );
  };

  // Create user
  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newPassword) return;
    setCreateError(null);
    setCreating(true);
    try {
      await createUserApi(newUsername.trim(), newPassword, newRole);
      setNewUsername("");
      setNewPassword("");
      await loadUsers();
    } catch (err: any) {
      setCreateError(
        err?.response?.data?.error ?? "Gagal membuat user, coba lagi.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="aski-perm-overlay" onClick={onClose}>
      <div
        className="aski-perm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="aski-perm-modal-header">
          <h2>Kelola Akses</h2>
          <button className="aski-perm-close" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="aski-perm-tabs">
          <button
            className={tab === "permissions" ? "active" : ""}
            onClick={() => setTab("permissions")}
          >
            Permissions Operator
          </button>
          <button
            className={tab === "users" ? "active" : ""}
            onClick={() => setTab("users")}
          >
            Manajemen User
          </button>
        </div>

        {/* ---- TAB: Permissions ---- */}
        {tab === "permissions" && (
          <div className="aski-perm-body">
            <p className="aski-perm-desc">
              Aktifkan fitur yang boleh digunakan oleh <strong>Operator</strong>.
              Admin selalu memiliki akses penuh.
            </p>
            <div className="aski-perm-list">
              {localPerms.map((p) => (
                <div key={p.permission_key} className="aski-perm-row">
                  <div className="aski-perm-info">
                    <span className="aski-perm-label">{p.label}</span>
                    <span className="aski-perm-desc-small">{p.description}</span>
                  </div>
                  <button
                    className={`aski-perm-toggle ${p.is_allowed ? "on" : "off"}`}
                    onClick={() => handleToggle(p.permission_key, p.is_allowed)}
                    disabled={saving === p.permission_key}
                    aria-label={p.is_allowed ? "Nonaktifkan" : "Aktifkan"}
                  >
                    {saving === p.permission_key ? "..." : p.is_allowed ? "ON" : "OFF"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- TAB: Users ---- */}
        {tab === "users" && (
          <div className="aski-perm-body">
            {/* Buat user baru */}
            <div className="aski-perm-create">
              <h3>Buat User Baru</h3>
              {createError && (
                <div className="aski-perm-create-error">{createError}</div>
              )}
              <div className="aski-perm-create-row">
                <input
                  type="text"
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  disabled={creating}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={creating}
                />
                <select
                  value={newRole}
                  onChange={(e) =>
                    setNewRole(e.target.value as "admin" | "operator")
                  }
                  disabled={creating}
                >
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  className="aski-perm-create-btn"
                  onClick={handleCreateUser}
                  disabled={creating || !newUsername.trim() || !newPassword}
                >
                  {creating ? "Membuat..." : "Buat"}
                </button>
              </div>
            </div>

            {/* Daftar user */}
            <h3>Daftar User</h3>
            {usersLoading ? (
              <p className="aski-perm-loading">Memuat...</p>
            ) : (
              <table className="aski-perm-user-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Terakhir Login</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={u.is_active ? "" : "inactive"}>
                      <td>{u.username}</td>
                      <td>
                        <span className={`aski-role-badge ${u.role}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="muted">
                        {u.last_login
                          ? new Date(u.last_login).toLocaleString("id-ID")
                          : "-"}
                      </td>
                      <td>
                        <button
                          className={`aski-perm-toggle ${u.is_active ? "on" : "off"} sm`}
                          onClick={() => handleToggleUser(u.id, u.is_active)}
                        >
                          {u.is_active ? "Aktif" : "Nonaktif"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PermissionsManager;
