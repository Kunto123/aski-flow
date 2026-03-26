/**
 * PermissionsManager
 *
 * Panel khusus Admin untuk:
 *  1. Buat akun user baru (Admin / Operator)
 *  2. Aktifkan / nonaktifkan akun
 *
 * Dibuka via tombol "Permissions" di header (hanya tampil untuk Admin).
 * Catatan: tab "Permissions Operator" dihapus — RBAC berbasis permission
 * dihapus; akses kini ditentukan oleh role (admin/operator) saja.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  UserRecord,
  createUserApi,
  listUsersApi,
  updateUserActiveApi,
} from "../../api/auth";

interface Props {
  onClose: () => void;
}

const PermissionsManager: React.FC<Props> = ({ onClose }) => {
  // ---- Users state ----
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "operator">("operator");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      setUsers(await listUsersApi());
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

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

        {/* ---- Users ---- */}
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
      </div>
    </div>
  );
};

export default PermissionsManager;
