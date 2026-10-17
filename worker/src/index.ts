import { Container } from "@cloudflare/containers";

/** Django backend running in a Cloudflare Container (see backend/Dockerfile). */
export class Backend extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "15m";
  // Readiness probe: the container counts as started once Django answers here.
  pingEndpoint = "localhost/api/health";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      DJANGO_SECRET_KEY: env.DJANGO_SECRET_KEY ?? "",
      ORS_API_KEY: env.ORS_API_KEY ?? "",
      ALLOWED_HOSTS: "*",
      DEBUG: "0",
    };
  }
}

const COLD_START_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

/**
 * True for the plain-text 500/503 responses @cloudflare/containers returns while an instance is
 * provisioning or booting. Django's own errors are JSON/HTML, so they are passed through untouched.
 */
async function isColdStart(res: Response): Promise<boolean> {
  if (res.status !== 503 && res.status !== 500) return false;
  if (!res.headers.get("content-type")?.startsWith("text/plain")) return false;
  const text = await res.clone().text();
  return text.startsWith("There is no Container instance") || text.startsWith("Failed to start container");
}

async function proxyToBackend(request: Request, env: Env): Promise<Response> {
  const stub = env.BACKEND.getByName("main");
  // Buffer the (small JSON) body once so the request can be replayed on a cold-start retry.
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const headers = new Headers(request.headers);
  // @cloudflare/containers reads this header to pick the container port; a client must never set
  // it (a non-numeric value throws and would burn the cold-start retries, a number targets an
  // arbitrary port). Django on defaultPort is the only target.
  for (const name of [...headers.keys()]) {
    if (name.startsWith("cf-container-")) headers.delete(name);
  }
  headers.set("X-Forwarded-Proto", "https");
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);

  let lastError: unknown;
  for (let attempt = 0; attempt <= COLD_START_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    try {
      const res = await stub.fetch(
        new Request(request.url, { method: request.method, headers, body, redirect: "manual" }),
      );
      if (!(await isColdStart(res))) return res;
      lastError = new Error(await res.text());
    } catch (err) {
      lastError = err;
    }
  }
  console.error("backend unavailable", lastError);
  return Response.json(
    { error: "Backend is starting up or unavailable. Please retry in a few seconds." },
    { status: 503, headers: { "Retry-After": "5" } },
  );
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return proxyToBackend(request, env);
    }
    // Only reached if run_worker_first is widened; assets are otherwise served before the Worker.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
