import type {
  GeocodeResponse,
  HealthResponse,
  HeatmapRequest,
  HeatmapResponse,
  RoutesRequest,
  RoutesResponse,
} from "./types";

/** An error the UI can show as is: the backend's `{"error": str}` or a network failure. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Dev only: `?fixture=1` renders the UI from a bundled sample instead of the
 * backend. `import.meta.env.DEV` is a build-time constant, so the branch and
 * the fixture chunks are dropped from production builds.
 */
export const FIXTURE_MODE =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("fixture");

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `The server answered ${res.status}. Try again in a moment.`;
    throw new ApiError(message, res.status);
  }
  if (body === null) throw new ApiError("The server sent an empty answer.", res.status);
  return body as T;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { signal });
}

export async function geocode(q: string, signal?: AbortSignal): Promise<GeocodeResponse> {
  const query = q.trim();
  if (query.length < 3) return { results: [] };
  if (FIXTURE_MODE) {
    const { fixtureGeocode } = await import("@/dev/fixture-api");
    return fixtureGeocode(query);
  }
  const params = new URLSearchParams({ q: query, limit: "5" });
  return request<GeocodeResponse>(`/api/geocode?${params.toString()}`, { signal });
}

export async function postRoutes(body: RoutesRequest, signal?: AbortSignal): Promise<RoutesResponse> {
  if (FIXTURE_MODE) {
    const { fixtureRoutes } = await import("@/dev/fixture-api");
    return fixtureRoutes(body);
  }
  return request<RoutesResponse>("/api/routes", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}

export async function postHeatmap(body: HeatmapRequest, signal?: AbortSignal): Promise<HeatmapResponse> {
  if (FIXTURE_MODE) {
    const { fixtureHeatmap } = await import("@/dev/fixture-api");
    return fixtureHeatmap(body);
  }
  return request<HeatmapResponse>("/api/heatmap", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}
