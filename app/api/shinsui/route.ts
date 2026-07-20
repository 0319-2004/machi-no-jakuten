const API_ROOT = "https://suiboumap.gsi.go.jp/shinsuimap/Api/Public";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 2_100; // 公式目安の毎分30リクエスト以下
const MAX_UPSTREAM_ATTEMPTS = 2;

type CacheEntry = {
  expiresAt: number;
  staleUntil: number;
  fetchedAt: number;
  value: unknown;
};

type FetchResult = {
  fetchedAt: number;
  stale: boolean;
  value: unknown;
};

const globalCache = globalThis as typeof globalThis & {
  __shinsuiCache?: Map<string, CacheEntry>;
  __shinsuiInflight?: Map<string, Promise<FetchResult>>;
  __shinsuiLastRequestAt?: number;
};

const cache = (globalCache.__shinsuiCache ??= new Map());
const inflight = (globalCache.__shinsuiInflight ??= new Map());

function validCoordinate(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

async function limitedFetch(key: string, url: string) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { value: cached.value, fetchedAt: cached.fetchedAt, stale: false };
  }
  const staleEntry = cached && cached.staleUntil > Date.now() ? cached : null;
  const running = inflight.get(key);
  if (running) return running;

  const request = (async () => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt += 1) {
      const elapsed = Date.now() - (globalCache.__shinsuiLastRequestAt ?? 0);
      if (elapsed < MIN_REQUEST_GAP_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_GAP_MS - elapsed));
      }
      globalCache.__shinsuiLastRequestAt = Date.now();

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Machi-no-Jakuten/1.1",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 429) throw new Error("rate-limit");
        if (!response.ok) throw new Error(`upstream-${response.status}`);
        const value = await response.json();
        const fetchedAt = Date.now();
        cache.set(key, {
          value,
          fetchedAt,
          expiresAt: fetchedAt + CACHE_TTL_MS,
          staleUntil: fetchedAt + STALE_CACHE_TTL_MS,
        });
        return { value, fetchedAt, stale: false };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "upstream-failure";
        const retryable = message !== "rate-limit" && (
          message.startsWith("upstream-5") ||
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === "TimeoutError")
        );
        console.warn("[shinsui] upstream request failed", {
          attempt,
          maxAttempts: MAX_UPSTREAM_ATTEMPTS,
          message,
          retrying: retryable && attempt < MAX_UPSTREAM_ATTEMPTS,
        });
        if (!retryable || attempt === MAX_UPSTREAM_ATTEMPTS) {
          if (staleEntry) {
            console.warn("[shinsui] serving stale cached data", {
              key,
              fetchedAt: new Date(staleEntry.fetchedAt).toISOString(),
              message,
            });
            return {
              value: staleEntry.value,
              fetchedAt: staleEntry.fetchedAt,
              stale: true,
            };
          }
          throw error;
        }
      }
    }
    throw lastError ?? new Error("upstream-failure");
  })();

  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!validCoordinate(lat, 35.7, 35.9) || !validCoordinate(lon, 139.5, 139.8)) {
    return Response.json({ error: "invalid-location" }, { status: 400 });
  }

  const roundedLat = lat.toFixed(5);
  const roundedLon = lon.toFixed(5);
  let endpoint = "";
  if (kind === "breakpoints") {
    endpoint = `GetBreakPoint?lon=${roundedLon}&lat=${roundedLat}`;
  } else if (kind === "hydrograph") {
    const bpid = params.get("bpid") ?? "";
    if (!/^[a-zA-Z0-9-]{3,80}$/.test(bpid)) {
      return Response.json({ error: "invalid-breakpoint" }, { status: 400 });
    }
    endpoint = `GetHydrographData?lon=${roundedLon}&lat=${roundedLat}&bpid=${encodeURIComponent(bpid)}`;
  } else {
    return Response.json({ error: "invalid-kind" }, { status: 400 });
  }

  try {
    const key = `${kind}:${roundedLat}:${roundedLon}:${params.get("bpid") ?? ""}`;
    const result = await limitedFetch(key, `${API_ROOT}/${endpoint}`);
    return Response.json(result.value, {
      headers: {
        "Cache-Control": result.stale
          ? "no-store"
          : "public, max-age=3600, stale-while-revalidate=86400",
        "X-Shinsui-Data-Status": result.stale ? "stale" : "fresh",
        "X-Shinsui-Fetched-At": new Date(result.fetchedAt).toISOString(),
        ...(result.stale ? { Warning: '110 - "Response is stale"' } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream-failure";
    console.error("[shinsui] request failed", {
      kind,
      lat: roundedLat,
      lon: roundedLon,
      message,
    });
    return Response.json(
      { error: message === "rate-limit" ? "rate-limit" : "upstream-failure" },
      {
        status: message === "rate-limit" ? 429 : 502,
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      },
    );
  }
}
