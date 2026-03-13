import React, { FormEvent, useState } from "react";
import { useAuth } from "../../providers/AuthProvider";

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ??
        err?.message ??
        "Login gagal. Periksa koneksi dan coba lagi.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aski-login-bg">
      <form className="aski-login-card" onSubmit={handleSubmit} noValidate>
        {/* Logo / judul */}
        <div className="aski-login-header">
          <span className="aski-login-logo">ASKI</span>
          <p className="aski-login-subtitle">AI Flow Platform</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="aski-login-error" role="alert">
            {error}
          </div>
        )}

        {/* Username */}
        <div className="aski-login-field">
          <label htmlFor="aski-username">Username</label>
          <input
            id="aski-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Masukkan username"
            disabled={loading}
            required
          />
        </div>

        {/* Password */}
        <div className="aski-login-field">
          <label htmlFor="aski-password">Password</label>
          <input
            id="aski-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Masukkan password"
            disabled={loading}
            required
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="aski-login-btn"
          disabled={loading || !username.trim() || !password}
        >
          {loading ? "Masuk..." : "Masuk"}
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
