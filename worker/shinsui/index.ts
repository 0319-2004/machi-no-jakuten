import { GET as handleShinsuiGet } from "../../app/api/shinsui/route.ts";

export interface Env {
  /**
   * Comma-separated, exact origins that may call this Worker in addition to
   * the two migration origins below. Origin values must not contain paths.
   */
  ALLOWED_ORIGINS?: string;
}

const SHINSUI_PATH = "/api/shinsui";
const MIGRATION_ORIGINS = [
  "https://0319-2004.github.io",
  "https://machi-no-jakuten.ritosuper.chatgpt.site",
];
const ALLOWED_METHODS = "GET, OPTIONS";
const ALLOWED_HEADERS = "Accept, Content-Type";
const EXPOSED_HEADERS = [
  "X-Shinsui-Data-Status",
  "X-Shinsui-Fetched-At",
  "Warning",
  "Retry-After",
].join(", ");

function configuredOrigins(env: Env): Set<string> {
  const origins = new Set(MIGRATION_ORIGINS);
  for (const value of env.ALLOWED_ORIGINS?.split(",") ?? []) {
    const origin = value.trim();
    if (origin) origins.add(origin);
  }
  return origins;
}

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }
  } catch {
    return false;
  }
  return configuredOrigins(env).has(origin);
}

function appendVary(headers: Headers, value: string) {
  const existing = headers.get("Vary");
  const values = new Set(
    existing?.split(",").map((item) => item.trim()).filter(Boolean) ?? [],
  );
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  headers.set("Access-Control-Expose-Headers", EXPOSED_HEADERS);
  appendVary(headers, "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonError(error: string, status: number, origin: string | null) {
  return withCors(Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  ), origin);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (url.pathname !== SHINSUI_PATH) {
      return jsonError("not-found", 404, isAllowedOrigin(origin, env) ? origin : null);
    }

    if (!isAllowedOrigin(origin, env)) {
      return jsonError("origin-not-allowed", 403, null);
    }

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Max-Age": "86400",
          Allow: ALLOWED_METHODS,
        },
      }), origin);
    }

    if (request.method !== "GET") {
      const response = jsonError("method-not-allowed", 405, origin);
      response.headers.set("Allow", ALLOWED_METHODS);
      return response;
    }

    return withCors(await handleShinsuiGet(request), origin);
  },
};

export default worker;
