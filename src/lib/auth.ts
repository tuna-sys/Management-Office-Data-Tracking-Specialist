import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
export type Role = "ADMIN" | "HR" | "FINANCE" | "VIEWER";
export type Identity = {
  username: string;
  role: Role;
  version: string;
};
type User = Identity & {
  salt: string;
  hash: string;
  isActive?: boolean;
};
export const COOKIE = "lincentive_session";
export const grants: Record<Role, string[]> = {
  ADMIN: [
    "read",
    "worker:write",
    "bank:write",
    "bonus:write",
    "bonus:approve",
    "export",
    "audit",
    "users",
  ],
  HR: ["read", "worker:write", "export"],
  FINANCE: ["read", "bank:write", "bonus:write", "bonus:approve", "export"],
  VIEWER: ["read"],
};
async function config(): Promise<{
  secret: string;
  users: User[];
}> {
  const data = JSON.parse(
    await readFile(
      path.resolve(process.env.LOCAL_AUTH_FILE || ".local/auth.json"),
      "utf8",
    ),
  );
  if (
    typeof data.secret !== "string" ||
    data.secret.length < 64 ||
    !Array.isArray(data.users)
  )
    throw new Error("Auth configuration unavailable");
  return data;
}
export async function authenticate(
  username: string,
  password: string,
): Promise<Identity | null> {
  const data = await config();
  const user = data.users.find((u) => u.username === username);
  const hash = scryptSync(
    password,
    user?.salt || "invalid-user-dummy-salt",
    64,
  );
  const expected = user ? Buffer.from(user.hash, "hex") : Buffer.alloc(64);
  if (
    !user ||
    user.isActive === false ||
    expected.length !== hash.length ||
    !timingSafeEqual(hash, expected)
  )
    return null;
  return { username: user.username, role: user.role, version: user.version };
}
export async function issueSession(user: Identity): Promise<string> {
  const { secret } = await config();
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + 8 * 60 * 60 * 1000 }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
export async function identity(request: NextRequest): Promise<Identity | null> {
  const host = request.headers.get("host") || "";
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {}
  const isLocal = ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
  const localIdentity: Identity | null =
    process.env.LOCAL_DEMO_AUTO_VIEW === "1" && isLocal
      ? { username: "Quản trị viên", role: "ADMIN", version: "local-auto-view" }
      : null;
  const token = request.cookies.get(COOKIE)?.value || "";
  if (!token) return localIdentity;
  try {
    if (token.length > 2048) return null;
    const [payload, signature, extra] = token.split(".");
    if (
      !payload ||
      !signature ||
      extra ||
      !/^[a-zA-Z0-9_-]+$/.test(payload) ||
      !/^[0-9a-f]{64}$/.test(signature)
    )
      return null;
    const data = await config();
    const expected = createHmac("sha256", data.secret).update(payload).digest();
    const actual = Buffer.from(signature, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof session.exp !== "number" || session.exp <= Date.now())
      return null;
    const user = data.users.find(
      (u) =>
        u.username === session.username &&
        u.version === session.version &&
        u.role === session.role,
    );
    return user && user.isActive !== false
      ? { username: user.username, role: user.role, version: user.version }
      : null;
  } catch {
    return null;
  }
}
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.host === request.headers.get("host") &&
      parsed.protocol === new URL(request.url).protocol
    );
  } catch {
    return false;
  }
}
export async function guard(request: NextRequest, permission = "read") {
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request))
    return NextResponse.json(
      { success: false, message: "Nguồn yêu cầu không hợp lệ" },
      { status: 403 },
    );
  const user = await identity(request);
  if (!user)
    return NextResponse.json(
      { success: false, message: "Vui lòng đăng nhập" },
      { status: 401 },
    );
  if (!grants[user.role]?.includes(permission))
    return NextResponse.json(
      { success: false, message: "Bạn không có quyền thực hiện thao tác này" },
      { status: 403 },
    );
  return null;
}
// Local single-process rate limiting; a shared store is required for multi-instance hosting.
const state = globalThis as typeof globalThis & {
  localAttempts?: Map<
    string,
    {
      count: number;
      until: number;
    }
  >;
};
export function rateLimit(
  key: string,
  limit = 10,
  windowMs = 15 * 60 * 1000,
): boolean {
  const attempts = (state.localAttempts ||= new Map());
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  const old = attempts.get(key);
  if (old) {
    old.count++;
    return old.count <= limit;
  }
  if (attempts.size >= 10000) return false;
  attempts.set(key, { count: 1, until: now + windowMs });
  return true;
}
import { open, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
export async function listUsers() {
  const data = await config();
  return data.users.map((u) => ({
    username: u.username,
    role: u.role,
    isActive: u.isActive !== false,
  }));
}
export async function saveUser(
  body: any,
  actor: string,
  auditAction?: "LOGOUT",
) {
  if (
    typeof body?.username !== "string" ||
    !/^[a-zA-Z0-9_.-]{3,64}$/.test(body.username) ||
    !Object.keys(grants).includes(body.role) ||
    (body.password !== undefined &&
      (typeof body.password !== "string" ||
        body.password.length < 12 ||
        body.password.length > 128))
  )
    throw new Error(
      "Tên đăng nhập, vai trò hoặc mật khẩu không hợp lệ (tối thiểu 12 ký tự)",
    );
  const file = path.resolve(process.env.LOCAL_AUTH_FILE || ".local/auth.json");
  await mkdir(path.dirname(file), { recursive: true });
  const lock = await open(file + ".lock", "wx").catch(() => {
    throw new Error("Cấu hình đang được cập nhật. Hãy thử lại.");
  });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    const data = await config();
    const existing = data.users.find((u) => u.username === body.username);
    if (body.mode === "create" && existing)
      throw new Error("Tên đăng nhập đã tồn tại");
    if (body.mode === "update" && !existing)
      throw new Error("Không tìm thấy tài khoản");
    if (!["create", "update"].includes(body.mode))
      throw new Error("Thao tác không hợp lệ");
    if (
      existing?.role === "ADMIN" &&
      existing.isActive !== false &&
      (body.role !== "ADMIN" || body.isActive === false) &&
      data.users.filter((u) => u.role === "ADMIN" && u.isActive !== false)
        .length === 1
    )
      throw new Error("Không được hạ quyền quản trị viên cuối cùng");
    if (!existing && !body.password)
      throw new Error("Cần mật khẩu để tạo tài khoản");
    const user: User = existing || {
      username: body.username,
      role: body.role,
      salt: "",
      hash: "",
      version: "",
    };
    if (body.isActive !== undefined && typeof body.isActive !== "boolean")
      throw new Error("Trạng thái tài khoản không hợp lệ");
    user.role = body.role;
    user.isActive = body.isActive ?? existing?.isActive ?? true;
    user.version = randomUUID();
    if (body.password) {
      user.salt = randomBytes(16).toString("hex");
      user.hash = scryptSync(body.password, user.salt, 64).toString("hex");
    }
    if (!existing) data.users.push(user);
    const stored = data as typeof data & {
      events?: any[];
    };
    stored.events = [
      ...(stored.events || []),
      {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        operator: actor,
        module: "AUTH",
        action: auditAction || (existing ? "UPDATE" : "CREATE"),
        details: `${existing ? "Cập nhật" : "Tạo"} tài khoản ${user.username} — ${user.role} — ${user.isActive ? "hoạt động" : "tạm khóa"}`,
      },
    ].slice(-10000);
    await writeFile(temp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(file + ".lock").catch(() => {});
  }
}
export async function authEvents() {
  try {
    return ((await config()) as any).events || [];
  } catch {
    return [];
  }
}
