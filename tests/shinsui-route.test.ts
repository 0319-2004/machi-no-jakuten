import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { GET } from "../app/api/shinsui/route.ts";

const originalFetch = globalThis.fetch;
type TestCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  fetchedAt: number;
  value: unknown;
};
const state = globalThis as typeof globalThis & {
  __shinsuiCache?: Map<string, TestCacheEntry>;
  __shinsuiInflight?: Map<string, unknown>;
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

function request(kind = "breakpoints", lat = 35.78814, bpid?: string) {
  const suffix = bpid ? `&bpid=${encodeURIComponent(bpid)}` : "";
  return new Request(`http://localhost/api/shinsui?kind=${kind}&lat=${lat}&lon=139.66147${suffix}`);
}

function expireFreshCache() {
  for (const entry of state.__shinsuiCache?.values() ?? []) {
    entry.expiresAt = 0;
  }
}

test("浸水ナビの正常応答を中継する", async () => {
  globalThis.fetch = async () => Response.json([{ ID: "bp-1" }]);
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Shinsui-Data-Status"), "fresh");
  assert.ok(response.headers.get("X-Shinsui-Fetched-At"));
  assert.deepEqual(await response.json(), [{ ID: "bp-1" }]);
});

test("空配列をリスクなしに変換せず返す", async () => {
  globalThis.fetch = async () => Response.json([]);
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("通信失敗を502として返す", async () => {
  globalThis.fetch = async () => {
    state.__shinsuiLastRequestAt = 0;
    return new Response("failed", { status: 503 });
  };
  const response = await GET(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream-failure" });
});

test("一時的な通信失敗後に公式APIへ一度だけ再試行する", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    state.__shinsuiLastRequestAt = 0;
    return calls === 1
      ? new Response("temporary", { status: 503 })
      : Response.json([{ ID: "bp-recovered" }]);
  };
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(await response.json(), [{ ID: "bp-recovered" }]);
});

test("利用制限応答を429として返す", async () => {
  globalThis.fetch = async () => new Response("limited", { status: 429 });
  const response = await GET(request());
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "rate-limit" });
});

test("タイムアウトを再試行後に502として返す", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    state.__shinsuiLastRequestAt = 0;
    throw new DOMException("timed out", "TimeoutError");
  };
  const response = await GET(request());
  assert.equal(calls, 2);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream-failure" });
});

test("公式API失敗時に同じリクエストの直前成功データを返す", async () => {
  globalThis.fetch = async () => Response.json([{ ID: "cached-bp" }]);
  await GET(request());
  expireFreshCache();
  state.__shinsuiLastRequestAt = 0;
  globalThis.fetch = async () => new Response("failed", { status: 404 });

  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Shinsui-Data-Status"), "stale");
  assert.ok(response.headers.get("X-Shinsui-Fetched-At"));
  assert.deepEqual(await response.json(), [{ ID: "cached-bp" }]);
});

test("staleキャッシュがなければ公式API失敗を502として返す", async () => {
  globalThis.fetch = async () => new Response("failed", { status: 404 });
  const response = await GET(request());
  assert.equal(response.status, 502);
});

test("別地点のキャッシュを流用しない", async () => {
  globalThis.fetch = async () => Response.json([{ ID: "first-point" }]);
  await GET(request());
  expireFreshCache();
  state.__shinsuiLastRequestAt = 0;
  globalThis.fetch = async () => new Response("failed", { status: 404 });

  const response = await GET(request("breakpoints", 35.789));
  assert.equal(response.status, 502);
});

test("breakpointsのキャッシュをhydrographへ流用しない", async () => {
  globalThis.fetch = async () => Response.json([{ ID: "breakpoint-only" }]);
  await GET(request());
  expireFreshCache();
  state.__shinsuiLastRequestAt = 0;
  globalThis.fetch = async () => new Response("failed", { status: 404 });

  const response = await GET(request("hydrograph", 35.78814, "bp-123"));
  assert.equal(response.status, 502);
});
