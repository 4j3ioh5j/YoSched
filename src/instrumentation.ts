// Card #266: once per server process, start the engine pool for the spacing trial.
// YOSCHED_VERSION / YOSCHED_COMMIT are written out literally so next.config's `env` inlines the
// release this server was built from; the worker bundle must carry the same stamp.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installEnginePool } = await import("./lib/engine-pool-install");
  installEnginePool(process.env, {
    version: process.env.YOSCHED_VERSION ?? "",
    commit: process.env.YOSCHED_COMMIT ?? "",
  });
}
