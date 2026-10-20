import { NextRequest, NextResponse } from "next/server";

function isLocal(request: NextRequest): boolean {
  try {
    const hostname = new URL(`http://${request.headers.get("host") || ""}`).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(hostname.toLowerCase());
  } catch {
    return false;
  }
}

// An audit label only: no account, password, role, cookie or session.
export async function identity(_request: NextRequest) {
  return { username: "Người dùng local" };
}

export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || !isLocal(request)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === request.headers.get("host") &&
      parsed.protocol === new URL(request.url).protocol;
  } catch {
    return false;
  }
}

export async function guard(request: NextRequest) {
  if (!isLocal(request) ||
    (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request))) {
    return NextResponse.json(
      { success: false, message: "Chỉ cho phép truy cập local và yêu cầu cùng nguồn" },
      { status: 403 },
    );
  }
  return null;
}

const state = globalThis as typeof globalThis & {
  localAttempts?: Map<string, { count: number; until: number }>;
};
export function rateLimit(key: string, limit = 10, windowMs = 15 * 60 * 1000): boolean {
  const attempts = (state.localAttempts ||= new Map());
  const now = Date.now();
  for (const [k, value] of attempts) if (value.until <= now) attempts.delete(k);
  const old = attempts.get(key);
  if (old) return ++old.count <= limit;
  if (attempts.size >= 10000) return false;
  attempts.set(key, { count: 1, until: now + windowMs });
  return true;
}
