import { mkdir, open, readFile, rename, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildImportSource, importSourcePublished, publishImportSource } from "@/lib/import-source-store";
import type { saveImportSource } from "@/lib/import-source-store";

const directory = path.resolve(process.env.LOCAL_IMPORT_RECOVERY_DIR || ".local/import-recovery");
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
type Meta = { runId: string; signature: string; operator: string };
type Manifest = { runId: string; signature: string; sources: Array<{ id: string; hash: string }>; status: number; body: any };
export class ImportRecoveryError extends Error {
  constructor(message: string, public status = 409, public importRunId?: string, public recoveryState?: string) { super(message); }
}
function folder(runId: string) {
  if (!validId.test(runId)) throw new ImportRecoveryError("Mã phiên import không hợp lệ", 400);
  return path.join(directory, runId.toLowerCase());
}
async function atomicWrite(file: string, value: unknown) {
  const temp = file + "." + randomUUID() + ".tmp";
  const handle = await open(temp, "wx");
  try { await handle.writeFile(JSON.stringify(value), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, file);
}
async function lock(runId: string) {
  const dir = folder(runId);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "run.lock");
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(target, "wx");
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token }), "utf8"); }
      finally { await handle.close(); }
      return async () => {
        const owner = JSON.parse(await readFile(target, "utf8"));
        if (owner.token === token) await unlink(target);
      };
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      let owner: any;
      try { owner = JSON.parse(await readFile(target, "utf8")); }
      catch { throw new ImportRecoveryError("Phiên đang được khóa; thử lại sau", 409, runId, "RUNNING"); }
      let alive = true;
      try { process.kill(owner.pid, 0); }
      catch (check: any) { if (check.code === "ESRCH") alive = false; }
      if (alive) throw new ImportRecoveryError("Phiên import đang chạy; không ghi lại đồng thời", 409, runId, "RUNNING");
      await unlink(target).catch((e: any) => { if (e.code !== "ENOENT") throw e; });
    }
  }
  throw new ImportRecoveryError("Chưa lấy được khóa phiên import", 409, runId);
}
async function receipt(db: any, runId: string) {
  return db.auditLog.findUnique({ where: { id: "import-run:" + runId.toLowerCase() } });
}
async function committedManifest(db: any, runId: string): Promise<Manifest | null> {
  const entry = await receipt(db, runId);
  if (!entry) return null;
  const proof = JSON.parse(entry.details || "{}");
  const content = await readFile(path.join(folder(runId), "manifest.json"), "utf8");
  if (digest(content) !== proof.manifestHash) throw new ImportRecoveryError("Nhật ký phục hồi không khớp biên nhận database; cần kiểm tra bản sao lưu", 409, runId, "NEEDS_REVIEW");
  const manifest = JSON.parse(content) as Manifest;
  if (manifest.runId !== runId || manifest.signature !== proof.signature) throw new ImportRecoveryError("Nhật ký phiên import không khớp", 409, runId);
  return manifest;
}
async function completed(manifest: Manifest) {
  try {
    const marker = JSON.parse(await readFile(path.join(folder(manifest.runId), "completed.json"), "utf8"));
    if (marker.manifestHash !== digest(JSON.stringify(manifest))) throw new Error("Dấu hoàn tất phiên không khớp nhật ký");
    return true;
  } catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
}
async function publish(manifest: Manifest) {
  // Completed runs must respect source rows corrected or deleted after import.
  if (await completed(manifest)) return;
  for (const source of manifest.sources) {
    if (await importSourcePublished(source.id)) continue;
    const raw = await readFile(path.join(folder(manifest.runId), source.id + ".json"), "utf8");
    if (digest(raw) !== source.hash) throw new Error("Snapshot phục hồi không khớp dấu kiểm tra");
    const payload = JSON.parse(raw);
    if (payload.id !== source.id) throw new Error("Snapshot phục hồi không khớp nguồn");
    await publishImportSource(payload);
  }
  await atomicWrite(path.join(folder(manifest.runId), "completed.json"), { manifestHash: digest(JSON.stringify(manifest)), finishedAt: new Date().toISOString() });
}
function transactionFacade(tx: any): any {
  const facade = new Proxy(tx, { get(target, key) {
    if (key === "$transaction") return (action: any) => typeof action === "function" ? action(facade) : Promise.all(action);
    return Reflect.get(target, key);
  } });
  return facade;
}
class RejectedImport extends Error { constructor(public response: Response) { super("Import rejected"); } }
export async function runRecoverableImport(db: any, meta: Meta,
  apply: (tx: any, save: typeof saveImportSource) => Promise<Response>): Promise<Response> {
  const release = await lock(meta.runId);
  try {
    const existing = await committedManifest(db, meta.runId);
    if (existing) {
      if (existing.signature !== meta.signature) throw new ImportRecoveryError("Mã phiên đã dùng cho dữ liệu hoặc tùy chọn khác; cần quét lại", 409, meta.runId);
      await publish(existing);
      return NextResponse.json({ ...existing.body, replayed: true }, { status: existing.status });
    }
    const dir = folder(meta.runId);
    try {
      const pending = JSON.parse(await readFile(path.join(dir, "pending.json"), "utf8"));
      if (pending.signature !== meta.signature) throw new ImportRecoveryError("Mã phiên đã gắn với dữ liệu hoặc database khác; cần quét lại", 409, meta.runId);
    } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    await atomicWrite(path.join(dir, "pending.json"), { ...meta, startedAt: new Date().toISOString() });
    let manifest: Manifest | undefined;
    try {
      await db.$transaction(async (tx: any) => {
        const sources: Manifest["sources"] = [];
        const stage: typeof saveImportSource = async (...args) => {
          const payload = buildImportSource(...args);
          await atomicWrite(path.join(dir, payload.id + ".json"), payload);
          sources.push({ id: payload.id, hash: digest(JSON.stringify(payload)) });
          return payload.id;
        };
        const response = await apply(transactionFacade(tx), stage);
        const body = await response.clone().json();
        if (!response.ok || !body.success) throw new RejectedImport(response);
        manifest = { runId: meta.runId, signature: meta.signature, sources, status: response.status,
          body: { ...body, importRunId: meta.runId } };
        await atomicWrite(path.join(dir, "manifest.json"), manifest);
        await tx.auditLog.create({ data: { id: "import-run:" + meta.runId.toLowerCase(), module: "IMPORT_RECOVERY", action: "COMMIT_IMPORT",
          operator: meta.operator, details: JSON.stringify({ runId: meta.runId, signature: meta.signature, manifestHash: digest(JSON.stringify(manifest)) }) } });
      }, { maxWait: 15000, timeout: 600000 });
    } catch (error) {
      if (error instanceof RejectedImport) return error.response;
      let committed: boolean | null = null;
      try { committed = !!(await receipt(db, meta.runId)); } catch { /* Unknown commit state must not be called safe to retry. */ }
      const state = committed === true ? "RECOVERABLE" : committed === false ? "RETRYABLE" : "NEEDS_REVIEW";
      const message = committed === true ? "Database đã commit; cần phục hồi snapshot nguồn"
        : committed === false ? "Phiên chưa commit; các thay đổi database đã hoàn tác. Có thể thử lại cùng phiên. " + String((error as any)?.message || "")
        : "Chưa xác minh được trạng thái commit; kiểm tra phiên phục hồi trước khi nhập lại";
      throw new ImportRecoveryError(message, 503, meta.runId, state);
    }
    try { await publish(manifest!); }
    catch { throw new ImportRecoveryError("Database đã ghi xong; snapshot nguồn chưa hoàn tất. Bấm Phục hồi phiên, không nhập lại thành phiên mới", 503, meta.runId, "RECOVERABLE"); }
    return NextResponse.json(manifest!.body, { status: manifest!.status });
  } finally { await release(); }
}
export async function recoverCommittedImport(db: any, runId: string): Promise<Response> {
  const release = await lock(runId);
  try {
    const manifest = await committedManifest(db, runId);
    if (!manifest) throw new ImportRecoveryError("Phiên chưa commit database; tải lại nguồn và quét trước khi thử ghi lại", 409, runId, "RETRYABLE");
    await publish(manifest);
    return NextResponse.json({ ...manifest.body, replayed: true }, { status: manifest.status });
  } finally { await release(); }
}
export async function listImportRecovery(db: any) {
  let names: string[];
  try { names = (await readdir(directory)).filter(n => validId.test(n)); }
  catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
  const runs = await Promise.all(names.map(async runId => {
    try {
      const pending = JSON.parse(await readFile(path.join(folder(runId), "pending.json"), "utf8"));
      const manifest = await committedManifest(db, runId);
      let state = "RETRYABLE";
      if (manifest) state = await completed(manifest) ? "COMPLETED" : "RECOVERABLE";
      else {
        try { const owner = JSON.parse(await readFile(path.join(folder(runId), "run.lock"), "utf8")); process.kill(owner.pid, 0); state = "RUNNING"; }
        catch { /* No live writer: an uncommitted SQLite transaction is rolled back. */ }
      }
      return { runId, state, startedAt: pending.startedAt, sourceCount: manifest?.sources.length || 0 };
    } catch { return { runId, state: "NEEDS_REVIEW", startedAt: "", sourceCount: 0 }; }
  }));
  return runs.sort((a,b) => Number(a.state === "COMPLETED") - Number(b.state === "COMPLETED") || b.startedAt.localeCompare(a.startedAt)).slice(0, 30);
}
