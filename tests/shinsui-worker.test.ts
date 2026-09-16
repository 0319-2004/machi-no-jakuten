import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import worker, { type Env } from "../worker/shinsui/index.ts";

const originalFetch = globalThis.fetch;
const ALLOWED_ORIGIN = "https://0319-2004.github.io";
const CURRENT_FRONTEND_ORIGIN = "https://machi-no-jakuten.ritosuper.chatgpt.site";
const CUSTOM_PREVIEW_ORIGIN = "https://frontend-preview.example.workers.dev";

type TestCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  fetchedAt: number;
  value: unknown;
};

const state = globalThis as typeof globalThis & {
  __shinsuiCache?: Map<string, TestCacheEntry>;
  __shinsuiInflight?: Map<string, Promise<unknown>>;
  __shinsuiLastRequestAt?: number;
};

beforeEach(() => {
  state.__shinsuiCache?.clear();
  state.__shinsuiInflight?.clear();
  state.__shinsuiLastRequestAt = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(
  query = "kind=breakpoints&lat=35.78814&lon=139.66147",
  options: RequestInit = {},
) {
  return new Request(`https://api.example.test/api/shinsui?${query}`, options);
}

function call(requestValue: Request, env: Env = {}) {
  return worker.fetch(requestValue, env);
}

function expireFreshCache() {
  for (const entry of state.__shinsuiCache?.values() ?? []) {
    entry.expiresAt = 0;
  }
}

test("GET /api/shinsui returns breakpoints and preserves freshness headers", async () => {
  globalThis.fetch = async (input) => {
    assert.match(String(input), /GetBreakPoint\?lon=139\.66147&lat=35\.78814$/);
    return Response.json([{ ID: "bp-1" }]);
  };

  const response = await call(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Shinsui-Data-Status"), "fresh");
  assert.ok(response.headers.get("X-Shinsui-Fetched-At"));
  assert.deepEqual(await response.json(), [{ ID: "bp-1" }]);
});

test("GET /api/shinsui returns hydrograph data", async () => {
  globalThis.fetch = async (input) => {
    assert.match(
      String(input),
      /GetHydrographData\?lon=139\.66147&lat=35\.78814&bpid=bp-123$/,
    );
    return Response.json({ data: [[0, 0], [1, 0.5]] });
  };

  const response = await call(request(
    "kind=hydrograph&lat=35.78814&lon=139.66147&bpid=bp-123",
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [[0, 0], [1, 0.5]] });
});

test("rejects invalid coordinates", async () => {
  const response = await call(request("kind=breakpoints&lat=0&lon=0"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid-location" });
});

test("rejects an invalid kind", async () => {
  const response = await call(request("kind=unknown&lat=35.78814&lon=139.66147"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid-kind" });
});

test("rejects an invalid bpid", async () => {
  const response = await call(request(
    "kind=hydrograph&lat=35.78814&lon=139.66147&bpid=%3Cscript%3E",
  ));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid-breakpoint" });
});

test("returns 429 without retrying the upstream rate limit", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("limited", { status: 429 });
  };

  const response = await call(request());
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
  assert.equal(response.headers.get("Retry-After"), "5");
  assert.deepEqual(await response.json(), { error: "rate-limit" });
});

test("retries a 5xx once and then returns 502", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    state.__shinsuiLastRequestAt = 0;
    return new Response("failed", { status: 503 });
  };

  const response = await call(request());
  assert.equal(calls, 2);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream-failure" });
});

test("retries a timeout once and then returns 502", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    state.__shinsuiLastRequestAt = 0;
    throw new DOMException("timed out", "TimeoutError");
  };

  const response = await call(request());
  assert.equal(calls, 2);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream-failure" });
});

test("returns a successful retry after one temporary 5xx", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    state.__shinsuiLastRequestAt = 0;
    return calls === 1
      ? new Response("temporary", { status: 503 })
      : Response.json([{ ID: "recovered" }]);
  };

  const response = await call(request());
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ ID: "recovered" }]);
});

test("serves a fresh cache entry without another upstream request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json([{ ID: "cached" }]);
  };

  await call(request());
  const response = await call(request());
  assert.equal(calls, 1);
  assert.equal(response.headers.get("X-Shinsui-Data-Status"), "fresh");
  assert.deepEqual(await response.json(), [{ ID: "cached" }]);
});

test("serves the same key's stale cache after an upstream failure", async () => {
  globalThis.fetch = async () => Response.json([{ ID: "stale" }]);
  await call(request());
  expireFreshCache();
  state.__shinsuiLastRequestAt = 0;
  globalThis.fetch = async () => new Response("failed", { status: 404 });

  const response = await call(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Shinsui-Data-Status"), "stale");
  assert.match(response.headers.get("Warning") ?? "", /Response is stale/);
  assert.deepEqual(await response.json(), [{ ID: "stale" }]);
});

test("coalesces simultaneous requests for the same cache key", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    calls += 1;
    await gate;
    return Response.json([{ ID: "coalesced" }]);
  };

  const first = call(request());
  const second = call(request());
  await Promise.resolve();
  release();
  const responses = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(await responses[0].json(), [{ ID: "coalesced" }]);
  assert.deepEqual(await responses[1].json(), [{ ID: "coalesced" }]);
});

test("allows the GitHub Pages origin and exposes freshness headers", async () => {
  globalThis.fetch = async () => Response.json([{ ID: "cors" }]);
  const response = await call(request(undefined, {
    headers: { Origin: ALLOWED_ORIGIN },
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
  assert.match(response.headers.get("Vary") ?? "", /Origin/);
  const exposed = response.headers.get("Access-Control-Expose-Headers") ?? "";
  assert.match(exposed, /X-Shinsui-Data-Status/);
  assert.match(exposed, /X-Shinsui-Fetched-At/);
  assert.match(exposed, /Warning/);
  assert.match(exposed, /Retry-After/);
});

test("allows the current production frontend during migration", async () => {
  globalThis.fetch = async () => Response.json([]);
  const response = await call(request(undefined, {
    headers: { Origin: CURRENT_FRONTEND_ORIGIN },
  }));
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), CURRENT_FRONTEND_ORIGIN);
});

test("allows an exact environment-configured preview origin", async () => {
  globalThis.fetch = async () => Response.json([]);
  const response = await call(
    request(undefined, { headers: { Origin: CUSTOM_PREVIEW_ORIGIN } }),
    { ALLOWED_ORIGINS: CUSTOM_PREVIEW_ORIGIN },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), CUSTOM_PREVIEW_ORIGIN);
});

test("rejects a disallowed origin without a CORS allow-origin header", async () => {
  const response = await call(request(undefined, {
    headers: { Origin: "https://attacker.example" },
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(await response.json(), { error: "origin-not-allowed" });
});

test("answers an allowed OPTIONS preflight", async () => {
  const response = await call(request(undefined, {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "GET",
    },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");
});

test("returns 404 outside the standalone Worker route", async () => {
  const response = await call(new Request("https://api.example.test/"));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not-found" });
});
