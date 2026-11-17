// Card #314: which Prisma operations write. Used by the fail-closed backstop in
// src/lib/prisma.ts — a write outside the write gate throws (see src/lib/write-gate.ts).

const WRITE_OPS = new Set([
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany", "updateManyAndReturn",
  "upsert", "delete", "deleteMany",
  "$executeRaw", "$executeRawUnsafe",
]);
const WRITE_SQL = /\b(insert|update|delete|merge|truncate|alter|drop|create|copy)\b/i;

function sqlText(args: unknown): string {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) return args.map(sqlText).join(" ");
  if (args && typeof args === "object") {
    const a = args as { strings?: unknown; sql?: unknown; query?: unknown };
    return [a.strings, a.sql, a.query].map(sqlText).join(" ");
  }
  return "";
}

/** True when the operation can change the database. Raw queries count when their SQL can. */
export function isWriteOperation(operation: string, args: unknown): boolean {
  if (WRITE_OPS.has(operation)) return true;
  // A row lock (SELECT … FOR [NO KEY] UPDATE / SHARE) is a read, not a write.
  if (operation === "$queryRaw" || operation === "$queryRawUnsafe") return WRITE_SQL.test(sqlText(args).replace(/\bfor\s+(no\s+key\s+)?update\b/gi, ""));
  return false;
}
