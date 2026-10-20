import { PrismaClient } from "../../.generated/client";
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL chưa được cấu hình. Hãy thiết lập URL CSDL cho môi trường hiện tại.",
  );
const cache = globalThis as typeof globalThis & {
  evolutionPrisma?: PrismaClient;
};
export const prisma =
  cache.evolutionPrisma ||
  new PrismaClient({ datasources: { db: { url } }, log: ["error"] });
if (process.env.NODE_ENV !== "production") cache.evolutionPrisma = prisma;
