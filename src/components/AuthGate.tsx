"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { Spin } from "antd";
type User = {
  username: string;
  role: string;
  permissions: string[];
  localAutoView?: boolean;
};
const DEFAULT_USER: User = {
  username: "Quản trị viên",
  role: "ADMIN",
  permissions: [
    "read",
    "worker:write",
    "bank:write",
    "bonus:write",
    "bonus:approve",
    "export",
    "audit",
    "users",
  ],
  localAutoView: true,
};
const AuthContext = createContext<User | null>(null);
export const useIdentity = () => useContext(AuthContext);
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!active) return;
        setUser(response.ok && body.success ? body.data : null);
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setUser(null);
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.message || "Đăng nhập không thành công");
      const identityResponse = await fetch("/api/auth/me", {
        cache: "no-store",
      });
      const identityResult = await identityResponse.json();
      if (!identityResponse.ok || !identityResult.success)
        throw new Error(
          identityResult.message || "Không thể tải phiên đăng nhập",
        );
      setUser(identityResult.data);
      setPassword("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể kết nối máy chủ",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready && !user)
    return (
      <div className="p-12 text-center">
        <Spin tip="Đang khởi tạo giao diện..." />
      </div>
    );
  if (!user)
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h1 className="text-xl font-semibold text-slate-900">Đăng nhập</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hệ thống quản lý lao động và thưởng
          </p>
          <label className="mt-6 block text-sm font-medium text-slate-700">
            Tên đăng nhập
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1.5 block w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Mật khẩu
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 block w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
          </label>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full bg-blue-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
      </main>
    );
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}
