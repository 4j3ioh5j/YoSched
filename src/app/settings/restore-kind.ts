// Card #335: which lock a chosen backup file needs, read in the browser from its first line and
// header (the same layout as src/lib/backup/format.ts; nothing is decrypted). Only a guide for
// what to ask for: the server still checks the file on "Check file" and "Restore".

const MAGIC = "YOSCHED-BACKUP\n";
/** The magic line plus the longest header the server accepts (4096) and its newline. */
export const HEAD_BYTES = MAGIC.length + 4096 + 1;

export type BackupKind =
  | { kind: "manual" }
  | { kind: "automatic"; keyId: string; keyCreatedAt: string }
  | { kind: "unknown" };

export function backupKindOf(head: Uint8Array): BackupKind {
  const unknown: BackupKind = { kind: "unknown" };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, HEAD_BYTES));
  if (!text.startsWith(MAGIC)) return unknown;
  const end = text.indexOf("\n", MAGIC.length);
  if (end < 0) return unknown;
  let h: { format?: unknown; keyId?: unknown; keyCreatedAt?: unknown };
  try { h = JSON.parse(text.slice(MAGIC.length, end)); } catch { return unknown; }
  if (!h || typeof h !== "object") return unknown;
  if (h.format === 1) return { kind: "manual" };
  if (h.format === 2 && typeof h.keyId === "string" && /^[0-9a-f]{16}$/.test(h.keyId)
    && typeof h.keyCreatedAt === "string" && h.keyCreatedAt.length <= 40 && !Number.isNaN(Date.parse(h.keyCreatedAt))) {
    return { kind: "automatic", keyId: h.keyId, keyCreatedAt: h.keyCreatedAt };
  }
  return unknown;
}

export type RestoreGuide = { text: string; needsKey: boolean; askPass: boolean; passPlaceholder: string };

/** What to tell the person and which boxes to show, for the chosen file (null = none yet). */
export function restoreGuide(kind: BackupKind | null, day: (iso: string) => string): RestoreGuide {
  if (!kind) return { text: "Choose the backup file first. The page then tells you what it needs.", needsKey: false, askPass: false, passPlaceholder: "" };
  if (kind.kind === "manual") {
    return {
      text: "This is a manual backup (one you downloaded). Enter the passphrase you chose when you downloaded it. No key file is needed.",
      needsKey: false, askPass: true, passPlaceholder: "The passphrase you chose when you downloaded it",
    };
  }
  if (kind.kind === "automatic") {
    return {
      text: `This is an automatic backup. It opens with the key made on ${day(kind.keyCreatedAt)} (${kind.keyId}): choose that key file, and enter the key's passphrase (the one you chose when you made the key).`,
      needsKey: true, askPass: true, passPlaceholder: "The key's passphrase",
    };
  }
  return {
    text: "This file doesn't look like a YoSched backup. Check that you chose the right file (a backup ends in .yosched-backup).",
    needsKey: false, askPass: true, passPlaceholder: "Passphrase",
  };
}
