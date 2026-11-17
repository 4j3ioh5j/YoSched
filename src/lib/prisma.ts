import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { isWriteOperation } from "./prisma-write-guard";
import { writeGate } from "./write-gate";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const base = new PrismaClient({ adapter });
  // Card #314: fail closed. A write made outside the write gate (a route handler, getPayPeriods,
  // or a backup/restore) throws, so no writer can straddle a backup or follow a restore unseen.
  // The cast keeps the PrismaClient type every caller already uses; the runtime is the extended one.
  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (isWriteOperation(operation, args)) writeGate.requireToken(`${model ?? "raw"}.${operation}`);
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
