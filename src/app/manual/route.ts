import { getSession } from "@/lib/auth-guard";
import { MANUAL_HTML } from "./manual-html";

// Serve the user manual as a standalone HTML page, gated on the manual:view
// permission (granted to level-1+ groups by default). The HTML is generated from
// docs/USER-MANUAL.md by scripts/build-manual.mjs into manual-html.ts and imported
// here, so it's bundled into the standalone build — no runtime filesystem read
// (process.cwd() is .next/standalone in production, where repo paths don't resolve).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DENIED =
  "<!doctype html><meta charset=utf-8><title>Not available</title>" +
  "<body style=\"font-family:system-ui;background:#0f172a;color:#e2e8f0;" +
  "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0\">" +
  "<p>You don’t have access to the user manual. Ask an administrator.</p>";

export async function GET() {
  const { error } = await getSession("manual:view");
  if (error) {
    // The link is only shown to permitted users, so this is the shared-URL edge
    // case — return a friendly page rather than raw JSON.
    return new Response(DENIED, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response(MANUAL_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=300",
    },
  });
}
