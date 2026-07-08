// The URL sub-path the whole app is served under. YoSched lives at
// `https://yologiq.com/yosched` (an apex path, proxied to this origin), so Next.js
// runs with `basePath: BASE_PATH` — every route, asset, link, API path, cookie and
// auth endpoint lives beneath it. Keep this in sync with `basePath` in next.config.ts
// (that file can't import app modules, so the literal is duplicated there with a note).
export const BASE_PATH = "/yosched";

// Auth.js's own route base (the `[...nextauth]` handler + client), under BASE_PATH.
export const AUTH_BASE_PATH = `${BASE_PATH}/api/auth`;
