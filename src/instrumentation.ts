// Card #315: once per server process, start the automatic backup scheduler. It does nothing
// until automatic backups are switched on in Settings › Backup and Restore.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startAutoBackups } = await import("./lib/backup/auto-service");
  startAutoBackups();
}
