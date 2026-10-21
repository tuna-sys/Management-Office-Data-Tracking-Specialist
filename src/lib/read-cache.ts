type Entry = { version: string; expires: number; pending: Promise<unknown> };
const state = globalThis as typeof globalThis & { appReadCache?: Map<string, Entry>; appReadEpoch?: number };
const entries = () => state.appReadCache ||= new Map();
export function invalidateReadCache() { state.appReadEpoch = (state.appReadEpoch || 0) + 1; entries().clear(); }
export function readCacheEpoch() { return state.appReadEpoch || 0; }

// Bounded, process-local reuse of derived reads. Rejected loads are never cached.
export async function cachedRead<T>(key: string, version: string, load: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  const cache = entries();
  const old = cache.get(key);
  if (old && old.version === version && old.expires > Date.now()) return old.pending as Promise<T>;
  if (old) cache.delete(key);
  while (cache.size >= 8) cache.delete(cache.keys().next().value!);
  const entry: Entry = { version, expires: Infinity, pending: Promise.resolve() };
  entry.pending = Promise.resolve().then(load).then(result => {
    entry.expires = Date.now() + ttlMs;
    return result;
  }).catch(error => { if (cache.get(key) === entry) cache.delete(key); throw error; });
  cache.set(key, entry);
  return entry.pending as Promise<T>;
}
