import { invalidateReadCache } from "@/lib/read-cache";
import { PrismaClient } from "../../.generated/client";
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL chưa được cấu hình. Hãy thiết lập URL CSDL cho môi trường hiện tại.",
  );
const cache = globalThis as typeof globalThis & {
  evolutionPrisma?: PrismaClient;
  readCacheMiddlewareInstalled?: WeakSet<PrismaClient>;
};
export const prisma =
  cache.evolutionPrisma ||
  new PrismaClient({ datasources: { db: { url } }, log: ["error"] });
if (process.env.NODE_ENV !== "production") cache.evolutionPrisma = prisma;

const installed = cache.readCacheMiddlewareInstalled ||= new WeakSet<PrismaClient>();
if (!installed.has(prisma)) {
  prisma.$use(async (params, next) => {
    const write = /^(create|update|upsert|delete)/.test(params.action) || ["executeRaw", "executeRawUnsafe"].includes(params.action);
    if (write) invalidateReadCache();
    try { return await next(params); }
    finally { if (write) invalidateReadCache(); }
  });
  installed.add(prisma);
}
