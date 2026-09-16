"use client";

import dynamic from "next/dynamic";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BreakPointScenario,
  buildFrequencyHeadline,
  buildShinsuiTileTemplate,
  buildTimeHeadline,
  Coordinate,
  describeBreakPointCase,
  describeCoordinateDirection,
  DepthClass,
  fillTileTemplate,
  Flood3DMode,
  FloodFrequencyScenario,
  FloodShelter,
  FloodShelterDistance,
  formatMinutes,
  FREQUENCY_SCENARIOS,
  groupShelterTileRequests,
  heightComparison,
  HydrographPoint,
  isInsideRegion,
  nearestFloodShelters,
  Rgba,
  REGION_BOUNDS,
  ReturnPeriod,
  resolveShelterMarkerState,
  ShelterFloodTiming,
  summarizeFloodSamples,
  summarizeHydrograph,
  summarizeShelterFloodTiming,
  ViewScope,
} from "../lib/risk";
import { BreakPointDetailCard } from "./BreakPointDetailCard";
import ShelterDetailCard from "./ShelterDetailCard";
import ShelterFloodBadge from "./ShelterFloodBadge";
import {
  frequencyDocumentSourceName,
  frequencyMapSourceName,
  HAZARD_PORTAL_SOURCE,
  PLAN_SCALE_MAP_SOURCE,
  SHINSUI_NAVI_SOURCE,
} from "../lib/source-labels";

const CesiumFloodView = dynamic(() => import("./CesiumFloodView"), { ssr: false });

const TILE_SIZE = 256;
const MAP_ZOOM = 15;
const ANALYSIS_ZOOM = 15;
const SHELTER_ANALYSIS_ZOOM = 15;
const WALK_RADIUS_METERS = 800;
const FREQUENCY_ORIGINALS = "https://www.ktr.mlit.go.jp/arage/arage00953.html";
const SITE_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const SHINSUI_API_URL =
  process.env.NEXT_PUBLIC_SHINSUI_API_URL ?? "/api/shinsui";

type Place = Coordinate & { title: string };
type MapMode = "frequency" | "time";
type ScenarioKind = "start" | "depth" | "duration";
type MapDataStatus = {
  label: string;
  note: string;
  tone: "available" | "regional" | "unavailable";
};

type FloodTileAnalysis = {
  status: "loading" | "available" | "unavailable";
  pointDepthClass: DepthClass | null;
  coveragePercent: number | null;
};

type HydrographResponse = {
  data?: [number, number][];
  info?: {
    StartTime?: number;
    Depth_Max?: number;
    ShinSuiTime_Max?: number;
    Time_0_01?: number;
  };
};

type ApiFreshness = {
  stale: boolean;
  fetchedAt: string | null;
};

type SearchFeature = {
  geometry: { coordinates: [number, number] };
  properties: { title: string };
};

type ShelterGeoJson = {
  features: Array<{
    geometry: { coordinates: [number, number] };
    properties: Record<string, string>;
  }>;
};

const DEFAULT_PLACE: Place = {
  title: "高島平駅",
  lat: 35.78814,
  lng: 139.66147,
};

const PLAN_200_SCENARIO = FREQUENCY_SCENARIOS.find(
  (scenario) => scenario.period === 200,
) as FloodFrequencyScenario;
const MAXIMUM_SCENARIO = FREQUENCY_SCENARIOS.find(
  (scenario) => scenario.period === "maximum",
) as FloodFrequencyScenario;
const LOADING_TILE_ANALYSIS: FloodTileAnalysis = {
  status: "loading",
  pointDepthClass: null,
  coveragePercent: null,
};

const tileCache = new Map<string, Promise<Uint8ClampedArray | null>>();

function readApiFreshness(response: Response): ApiFreshness {
  return {
    stale: response.headers.get("X-Shinsui-Data-Status") === "stale",
    fetchedAt: response.headers.get("X-Shinsui-Fetched-At"),
  };
}

function formatFetchedAt(value: string | null) {
  if (!value) return "取得日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "取得日時不明";
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lngToWorldX(lng: number, zoom: number) {
  return ((lng + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToWorldY(lat: number, zoom: number) {
  const sine = Math.sin((lat * Math.PI) / 180);
  return (
    (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) *
    TILE_SIZE *
    2 ** zoom
  );
}

function worldToLngLat(x: number, y: number, zoom: number): Coordinate {
  const size = TILE_SIZE * 2 ** zoom;
  const lng = (x / size) * 360 - 180;
  const normalized = 0.5 - y / size;
  const lat = 90 - (360 * Math.atan(Math.exp(-normalized * 2 * Math.PI))) / Math.PI;
  return { lat, lng };
}

function metresPerPixel(lat: number, zoom: number) {
  return (
    (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6_378_137) /
    (TILE_SIZE * 2 ** zoom)
  );
}

function fitZoomForCoordinates(
  coordinates: readonly Coordinate[],
  size: { width: number; height: number },
) {
  const padding = size.width <= 620 ? 76 : 110;
  for (let candidate = 17; candidate >= 11; candidate -= 1) {
    const worldXs = coordinates.map((point) => lngToWorldX(point.lng, candidate));
    const worldYs = coordinates.map((point) => latToWorldY(point.lat, candidate));
    if (
      Math.max(...worldXs) - Math.min(...worldXs) <= Math.max(1, size.width - padding * 2) &&
      Math.max(...worldYs) - Math.min(...worldYs) <= Math.max(1, size.height - padding * 2)
    ) {
      return candidate;
    }
  }
  return 11;
}

function loadTilePixels(url: string) {
  const cached = tileCache.get(url);
  if (cached) return cached;
  const promise = new Promise<Uint8ClampedArray | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return resolve(null);
      try {
        context.drawImage(image, 0, 0);
        resolve(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  tileCache.set(url, promise);
  void promise.then((pixels) => {
    if (!pixels) tileCache.delete(url);
  });
  return promise;
}

async function analyseFloodTile(place: Place, tileTemplate: string): Promise<FloodTileAnalysis> {
  const centerX = lngToWorldX(place.lng, ANALYSIS_ZOOM);
  const centerY = latToWorldY(place.lat, ANALYSIS_ZOOM);
  const radiusPixels = WALK_RADIUS_METERS / metresPerPixel(place.lat, ANALYSIS_ZOOM);
  const minTileX = Math.floor((centerX - radiusPixels) / TILE_SIZE);
  const maxTileX = Math.floor((centerX + radiusPixels) / TILE_SIZE);
  const minTileY = Math.floor((centerY - radiusPixels) / TILE_SIZE);
  const maxTileY = Math.floor((centerY + radiusPixels) / TILE_SIZE);
  const sampledPixels: Rgba[] = [];
  let pointPixel: Rgba | null = null;
  let readableTile = false;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const pixels = await loadTilePixels(
        fillTileTemplate(tileTemplate, ANALYSIS_ZOOM, tileX, tileY),
      );
      if (!pixels) continue;
      readableTile = true;
      for (let pixelY = 8; pixelY < TILE_SIZE; pixelY += 16) {
        for (let pixelX = 8; pixelX < TILE_SIZE; pixelX += 16) {
          const worldX = tileX * TILE_SIZE + pixelX;
          const worldY = tileY * TILE_SIZE + pixelY;
          if (Math.hypot(worldX - centerX, worldY - centerY) > radiusPixels) continue;
          const index = (pixelY * TILE_SIZE + pixelX) * 4;
          sampledPixels.push([
            pixels[index],
            pixels[index + 1],
            pixels[index + 2],
            pixels[index + 3],
          ]);
        }
      }
      const pointTileX = Math.floor(centerX / TILE_SIZE);
      const pointTileY = Math.floor(centerY / TILE_SIZE);
      if (tileX === pointTileX && tileY === pointTileY) {
        const px = Math.max(0, Math.min(255, Math.floor(centerX - tileX * TILE_SIZE)));
        const py = Math.max(0, Math.min(255, Math.floor(centerY - tileY * TILE_SIZE)));
        const index = (py * TILE_SIZE + px) * 4;
        pointPixel = [
          pixels[index],
          pixels[index + 1],
          pixels[index + 2],
          pixels[index + 3],
        ];
      }
    }
  }

  const summary = summarizeFloodSamples(pointPixel, sampledPixels);
  return {
    status: readableTile ? "available" : "unavailable",
    pointDepthClass: summary.pointDepthClass,
    coveragePercent: readableTile ? summary.coveragePercent : null,
  };
}

function FloodMap({
  place,
  overlay,
  onSelect,
  dataStatus,
  credit,
  viewScope,
  mode,
  nearestShelters,
  shelterFloodTimings,
  currentMinutes,
  showShelters,
  shelterDataStatus,
  selectedBreakpoint,
  selectedShelterId,
  onMarkerSelect,
  onViewInList,
  mapRef,
}: {
  place: Place;
  overlay: string | null;
  onSelect: (place: Place) => void;
  dataStatus: MapDataStatus | null;
  credit: string;
  viewScope: ViewScope;
  mode: MapMode;
  nearestShelters: FloodShelterDistance[];
  shelterFloodTimings: Record<string, ShelterFloodTiming>;
  currentMinutes: number;
  showShelters: boolean;
  shelterDataStatus: "loading" | "ready" | "error";
  selectedBreakpoint: BreakPointScenario | null | undefined;
  selectedShelterId: string | null;
  onMarkerSelect: (shelterId: string) => void;
  onViewInList: (shelterId: string) => void;
  mapRef: { current: HTMLDivElement | null };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(viewScope === "district" ? 13 : MAP_ZOOM);
  const [size, setSize] = useState({ width: 960, height: 520 });
  const [breakPointOpen, setBreakPointOpen] = useState(false);
  const [focusBreakPoint, setFocusBreakPoint] = useState(false);

  useEffect(() => {
    if (focusBreakPoint) return;
    setZoom(viewScope === "district" ? 13 : MAP_ZOOM);
  }, [focusBreakPoint, viewScope]);

  useEffect(() => {
    setBreakPointOpen(false);
    setFocusBreakPoint(false);
  }, [mode, selectedBreakpoint?.BPName]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!focusBreakPoint || mode !== "time" || !selectedBreakpoint) return;
    setZoom(fitZoomForCoordinates([
      place,
      { lat: selectedBreakpoint.BPLat, lng: selectedBreakpoint.BPLon },
    ], size));
  }, [focusBreakPoint, mode, place, selectedBreakpoint, size]);

  const breakPointCoordinate = mode === "time" && selectedBreakpoint
    ? { lat: selectedBreakpoint.BPLat, lng: selectedBreakpoint.BPLon }
    : null;
  const mapCenter = focusBreakPoint && breakPointCoordinate
    ? {
        lng: (place.lng + breakPointCoordinate.lng) / 2,
        lat: (place.lat + breakPointCoordinate.lat) / 2,
      }
    : viewScope === "district"
    ? {
        lng: (REGION_BOUNDS.west + REGION_BOUNDS.east) / 2,
        lat: (REGION_BOUNDS.south + REGION_BOUNDS.north) / 2,
      }
    : place;
  const centerX = lngToWorldX(mapCenter.lng, zoom);
  const centerY = latToWorldY(mapCenter.lat, zoom);
  const placeX = lngToWorldX(place.lng, zoom);
  const placeY = latToWorldY(place.lat, zoom);
  const placeLeft = size.width / 2 + placeX - centerX;
  const placeTop = size.height / 2 + placeY - centerY;
  const minTileX = Math.floor((centerX - size.width / 2) / TILE_SIZE);
  const maxTileX = Math.floor((centerX + size.width / 2) / TILE_SIZE);
  const minTileY = Math.floor((centerY - size.height / 2) / TILE_SIZE);
  const maxTileY = Math.floor((centerY + size.height / 2) / TILE_SIZE);
  const tiles: Array<{ x: number; y: number; left: number; top: number }> = [];
  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) {
      tiles.push({
        x,
        y,
        left: x * TILE_SIZE - (centerX - size.width / 2),
        top: y * TILE_SIZE - (centerY - size.height / 2),
      });
    }
  }

  const shelterMarkers = showShelters
    ? nearestShelters.map((shelter, index) => {
        const shelterX = lngToWorldX(shelter.lng, zoom);
        const shelterY = latToWorldY(shelter.lat, zoom);
        return {
          shelter,
          rank: index + 1,
          left: size.width / 2 + shelterX - centerX,
          top: size.height / 2 + shelterY - centerY,
          state: resolveShelterMarkerState(
            mode,
            shelterFloodTimings[shelter.id],
            currentMinutes,
          ),
        };
      })
    : [];
  const selectedShelterMarker = shelterMarkers.find(
    (marker) => marker.shelter.id === selectedShelterId,
  );
  const breakPointMarker = breakPointCoordinate
    ? {
        left: size.width / 2 + lngToWorldX(breakPointCoordinate.lng, zoom) - centerX,
        top: size.height / 2 + latToWorldY(breakPointCoordinate.lat, zoom) - centerY,
      }
    : null;
  const breakPointVisible = Boolean(
    breakPointMarker &&
    breakPointMarker.left >= 46 &&
    breakPointMarker.left <= size.width - 46 &&
    breakPointMarker.top >= 46 &&
    breakPointMarker.top <= size.height - 46,
  );
  const breakPointDirection = breakPointCoordinate
    ? describeCoordinateDirection(place, breakPointCoordinate)
    : null;

  const selectPoint = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const worldX = centerX + event.clientX - box.left - box.width / 2;
    const worldY = centerY + event.clientY - box.top - box.height / 2;
    const coordinate = worldToLngLat(worldX, worldY, zoom);
    onSelect({ ...coordinate, title: "地図で選んだ地点" });
  };

  const radius = WALK_RADIUS_METERS / metresPerPixel(place.lat, zoom);
  return (
    <div className="map-wrap" ref={mapRef}>
      <div
        className="map-viewport"
        ref={containerRef}
        onClick={selectPoint}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect({ ...place, title: "地図中央の地点" });
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="地図をタップして地点を選択"
      >
        {tiles.map((tile) => (
          <img
            key={`base-${zoom}-${tile.x}-${tile.y}`}
            className="map-tile"
            src={`https://cyberjapandata.gsi.go.jp/xyz/pale/${zoom}/${tile.x}/${tile.y}.png`}
            style={{ left: tile.left, top: tile.top }}
            alt=""
            draggable={false}
          />
        ))}
        {overlay &&
          tiles.map((tile) => (
            <img
              key={`overlay-${overlay}-${zoom}-${tile.x}-${tile.y}`}
              className="map-tile flood-tile"
              src={fillTileTemplate(overlay, zoom, tile.x, tile.y)}
              style={{ left: tile.left, top: tile.top }}
              alt=""
              draggable={false}
              onError={(event) => { event.currentTarget.style.display = "none"; }}
            />
          ))}
        {dataStatus && (
          <div className={`map-data-status ${dataStatus.tone}`}>
            <strong>{dataStatus.label}</strong>
            <span>{dataStatus.note}</span>
          </div>
        )}
        <div
          className="walk-ring"
          style={{ width: radius * 2, height: radius * 2, left: placeLeft - radius, top: placeTop - radius }}
        >
          <span>半径800m</span>
        </div>
        <div className="map-pin" style={{ left: placeLeft, top: placeTop }} aria-hidden="true"><span /></div>
        {focusBreakPoint && (
          <button
            type="button"
            className="map-breakpoint-return"
            onClick={(event) => {
              event.stopPropagation();
              setFocusBreakPoint(false);
              setBreakPointOpen(false);
            }}
          >
            選択地点へ戻る
          </button>
        )}
        {breakPointVisible && breakPointMarker && selectedBreakpoint && (
          <button
            type="button"
            className={`map-breakpoint-marker${breakPointOpen ? " selected" : ""}`}
            style={{ left: breakPointMarker.left, top: breakPointMarker.top }}
            aria-label={`想定上の決壊地点、${describeBreakPointCase(selectedBreakpoint).displayLabel}、詳細を${breakPointOpen ? "閉じる" : "開く"}`}
            aria-pressed={breakPointOpen}
            onClick={(event) => {
              event.stopPropagation();
              setBreakPointOpen((value) => !value);
            }}
          >
            <span aria-hidden="true">▲</span>
            <small>想定上の決壊地点</small>
          </button>
        )}
        {breakPointOpen && breakPointVisible && breakPointMarker && selectedBreakpoint && (() => {
          const placeCardBelow = breakPointMarker.top < 230;
          return (
            <aside
              className={`map-shelter-card map-breakpoint-card${placeCardBelow ? " below" : ""}`}
              style={{
                left: Math.max(170, Math.min(size.width - 170, breakPointMarker.left)),
                top: placeCardBelow ? breakPointMarker.top + 46 : breakPointMarker.top - 46,
              }}
              aria-label="想定上の決壊地点の詳細"
              onClick={(event) => event.stopPropagation()}
            >
              <BreakPointDetailCard
                scenario={selectedBreakpoint}
                onClose={() => setBreakPointOpen(false)}
              />
            </aside>
          );
        })()}
        {!breakPointVisible && breakPointDirection && selectedBreakpoint && (
          <div className="map-breakpoint-direction" onClick={(event) => event.stopPropagation()}>
            <strong>
              {breakPointDirection.arrow} 決壊地点は{breakPointDirection.compassLabel}方向 {breakPointDirection.distanceLabel}
            </strong>
            <button
              type="button"
              onClick={() => {
                setBreakPointOpen(false);
                setFocusBreakPoint(true);
              }}
            >
              決壊地点を見る
            </button>
          </div>
        )}
        {shelterMarkers.map(({ shelter, rank, left, top, state }) => {
          const selected = shelter.id === selectedShelterId;
          const distance = shelter.distanceMeters < 1000
            ? `${shelter.distanceMeters}m`
            : `${(shelter.distanceMeters / 1000).toFixed(1)}km`;
          return (
            <button
              key={shelter.id}
              type="button"
              className={`map-shelter-marker ${state}${selected ? " selected" : ""}`}
              style={{ left, top }}
              aria-label={`避難場所 0${rank} ${shelter.name}、選択地点から直線${distance}、詳細を${selected ? "閉じる" : "開く"}`}
              aria-pressed={selected}
              onClick={(event) => {
                event.stopPropagation();
                onMarkerSelect(shelter.id);
              }}
            >
              <span>0{rank}</span>
            </button>
          );
        })}
        {selectedShelterMarker && (() => {
          const { shelter, rank, left, top } = selectedShelterMarker;
          const placeCardBelow = top < 230;
          return (
            <aside
              className={`map-shelter-card${placeCardBelow ? " below" : ""}`}
              style={{
                left: Math.max(170, Math.min(size.width - 170, left)),
                top: placeCardBelow ? top + 34 : top - 34,
              }}
              aria-label={`${shelter.name}の詳細`}
              onClick={(event) => event.stopPropagation()}
            >
              <ShelterDetailCard
                shelter={shelter}
                rank={rank}
                mode={mode}
                timing={shelterFloodTimings[shelter.id]}
                origin={place}
                onViewInList={onViewInList}
              />
            </aside>
          );
        })()}
        {showShelters && shelterDataStatus !== "loading" && !nearestShelters.length && (
          <div className="map-shelter-status">
            <strong>避難場所データを確認できません。</strong>
            <span>対象外またはデータ未整備の可能性があります。</span>
          </div>
        )}
        <div className="zoom-control" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setZoom((value) => Math.min(17, value + 1))} aria-label="拡大">＋</button>
          <button type="button" onClick={() => setZoom((value) => Math.max(focusBreakPoint ? 11 : 13, value - 1))} aria-label="縮小">−</button>
        </div>
        <div className="map-credit">{credit}</div>
      </div>
    </div>
  );
}

function Hydrograph({ points, currentMinutes }: { points: HydrographPoint[]; currentMinutes: number }) {
  if (!points.length) return <div className="empty-chart">時系列データを確認できません。</div>;
  const width = 760;
  const height = 220;
  const maxHours = Math.max(...points.map((point) => point.hours), 1);
  const maxDepth = Math.max(...points.map((point) => point.depthMeters), 1);
  const path = points
    .map((point, index) => {
      const x = 36 + (point.hours / maxHours) * (width - 56);
      const y = height - 30 - (point.depthMeters / maxDepth) * (height - 54);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const cursorX = 36 + (Math.min(currentMinutes / 60, maxHours) / maxHours) * (width - 56);
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="選択地点の浸水深の時間変化">
        <line x1="36" y1="12" x2="36" y2={height - 30} className="chart-axis" />
        <line x1="36" y1={height - 30} x2={width - 20} y2={height - 30} className="chart-axis" />
        <path d={path} className="chart-area" />
        <line x1={cursorX} y1="12" x2={cursorX} y2={height - 30} className="chart-cursor" />
        <text x="8" y="22">{maxDepth.toFixed(1)}m</text>
        <text x={width - 62} y={height - 8}>{Math.round(maxHours)}h</text>
      </svg>
    </div>
  );
}

export default function Home() {
  const [place, setPlace] = useState(DEFAULT_PLACE);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [mode, setMode] = useState<MapMode>("frequency");
  const [period, setPeriod] = useState<ReturnPeriod>("maximum");
  const [maximum, setMaximum] = useState<FloodTileAnalysis>(LOADING_TILE_ANALYSIS);
  const [plan200, setPlan200] = useState<FloodTileAnalysis>(LOADING_TILE_ANALYSIS);
  const [breakpoints, setBreakpoints] = useState<BreakPointScenario[]>([]);
  const [breakpointStatus, setBreakpointStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error" | "limited">("idle");
  const [breakpointReload, setBreakpointReload] = useState(0);
  const [breakpointFreshness, setBreakpointFreshness] = useState<ApiFreshness | null>(null);
  const [scenarioKind, setScenarioKind] = useState<ScenarioKind>("depth");
  const [hydrograph, setHydrograph] = useState<HydrographPoint[]>([]);
  const [hydroInfo, setHydroInfo] = useState<HydrographResponse["info"]>();
  const [hydroStatus, setHydroStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [hydroReload, setHydroReload] = useState(0);
  const [hydroFreshness, setHydroFreshness] = useState<ApiFreshness | null>(null);
  const [timeIndex, setTimeIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shelters, setShelters] = useState<FloodShelter[]>([]);
  const [shelterDataStatus, setShelterDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [shelterFloodTimings, setShelterFloodTimings] = useState<Record<string, ShelterFloodTiming>>({});
  const [showShelters, setShowShelters] = useState(true);
  const [selectedShelterId, setSelectedShelterId] = useState<string | null>(null);
  const [view3d, setView3d] = useState(false);
  const [viewScope, setViewScope] = useState<ViewScope>("local");
  const [flood3DMode, setFlood3DMode] = useState<Flood3DMode>("official");
  const mapWrapRef = useRef<HTMLDivElement>(null);
  const mapSectionRef = useRef<HTMLElement>(null);
  const shelterCardRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    setMaximum(LOADING_TILE_ANALYSIS);
    setPlan200(LOADING_TILE_ANALYSIS);
    if (MAXIMUM_SCENARIO.tileTemplate) {
      analyseFloodTile(place, MAXIMUM_SCENARIO.tileTemplate).then(
        (result) => !cancelled && setMaximum(result),
      );
    }
    if (PLAN_200_SCENARIO.tileTemplate) {
      analyseFloodTile(place, PLAN_200_SCENARIO.tileTemplate).then(
        (result) => !cancelled && setPlan200(result),
      );
    }
    return () => { cancelled = true; };
  }, [place]);

  useEffect(() => {
    fetch(`${SITE_BASE_PATH}/data/itabashi-shelters.geojson`)
      .then((response) => {
        if (!response.ok) throw new Error("failed");
        return response.json();
      })
      .then((data: ShelterGeoJson) => {
        setShelters(
          data.features.map((feature) => ({
            id: feature.properties["共通ID"] || feature.properties.NO,
            name: feature.properties["施設・場所名"],
            address: feature.properties["住所"],
            supportsFlood: feature.properties["洪水"] === "1" || feature.properties["洪水"] === "○",
            lat: feature.geometry.coordinates[1],
            lng: feature.geometry.coordinates[0],
            note: feature.properties["備考"],
          })),
        );
        setShelterDataStatus("ready");
      })
      .catch(() => {
        setShelters([]);
        setShelterDataStatus("error");
      });
  }, []);

  useEffect(() => {
    if (mode !== "time" || !isInsideRegion(place)) return;
    const controller = new AbortController();
    setBreakpointStatus("loading");
    setBreakpoints([]);
    setBreakpointFreshness(null);
    setHydrograph([]);
    setHydroInfo(undefined);
    setHydroFreshness(null);
    setHydroStatus("idle");
    setTimeIndex(0);
    setPlaying(false);
    fetch(`${SHINSUI_API_URL}?kind=breakpoints&lat=${place.lat}&lon=${place.lng}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 429) throw new Error("limited");
        if (!response.ok) throw new Error("failed");
        return {
          items: await response.json() as BreakPointScenario[],
          freshness: readApiFreshness(response),
        };
      })
      .then(({ items, freshness }) => {
        const arakawa = items.filter((item) => item.EntryRiverName === "荒川" || item.RiverCode === "8303040001");
        setBreakpoints(arakawa.length ? arakawa : items);
        setBreakpointStatus(items.length ? "ready" : "empty");
        setBreakpointFreshness(freshness);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBreakpointStatus(error instanceof Error && error.message === "limited" ? "limited" : "error");
      });
    return () => controller.abort();
  }, [breakpointReload, mode, place]);

  const selectedBreakpoint = useMemo(() => {
    const match = breakpoints.find((item) =>
      scenarioKind === "start" ? item.isStartMax : scenarioKind === "duration" ? item.isDurationMax : item.isDepthMax,
    );
    return match ?? breakpoints[0];
  }, [breakpoints, scenarioKind]);

  useEffect(() => {
    if (!selectedBreakpoint || mode !== "time") return;
    const controller = new AbortController();
    setHydroStatus("loading");
    setHydrograph([]);
    setHydroFreshness(null);
    setTimeIndex(0);
    fetch(`${SHINSUI_API_URL}?kind=hydrograph&lat=${place.lat}&lon=${place.lng}&bpid=${selectedBreakpoint.ID}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("failed");
        return {
          data: await response.json() as HydrographResponse,
          freshness: readApiFreshness(response),
        };
      })
      .then(({ data, freshness }) => {
        setHydrograph((data.data ?? []).map(([hours, depthMeters]) => ({ hours, depthMeters })));
        setHydroInfo(data.info);
        setHydroStatus(data.data?.length ? "ready" : "error");
        setHydroFreshness(freshness);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHydroStatus("error");
      });
    return () => controller.abort();
  }, [hydroReload, mode, place, selectedBreakpoint]);

  const timeSteps = selectedBreakpoint?.BPTime ?? [];
  const currentMinutes = timeSteps[timeIndex] ?? 0;

  useEffect(() => {
    if (!playing || timeSteps.length < 2) return;
    const timer = window.setInterval(() => {
      setTimeIndex((value) => {
        if (value >= timeSteps.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, 850);
    return () => window.clearInterval(timer);
  }, [playing, timeSteps.length]);

  const hydroSummary = useMemo(
    () => summarizeHydrograph(hydrograph, {
      startMinutes: hydroInfo?.StartTime,
      maxDepthMeters: hydroInfo?.Depth_Max,
      maxDepthAtMinutes: hydroInfo?.ShinSuiTime_Max,
      durationMinutes: hydroInfo?.Time_0_01,
    }),
    [hydroInfo, hydrograph],
  );

  const currentDepth = useMemo(() => {
    if (!hydrograph.length) return null;
    return hydrograph.reduce((best, point) =>
      Math.abs(point.hours * 60 - currentMinutes) < Math.abs(best.hours * 60 - currentMinutes) ? point : best,
    ).depthMeters;
  }, [currentMinutes, hydrograph]);

  const nearest = useMemo(() => nearestFloodShelters(place, shelters, 3), [place, shelters]);

  useEffect(() => {
    if (selectedShelterId && !nearest.some((shelter) => shelter.id === selectedShelterId)) {
      setSelectedShelterId(null);
    }
  }, [nearest, selectedShelterId]);

  useEffect(() => {
    const controller = new AbortController();
    if (mode !== "time" || !selectedBreakpoint || !nearest.length) {
      setShelterFloodTimings({});
      return () => controller.abort();
    }

    const officialSteps = [...new Set(selectedBreakpoint.BPTime)]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const samples = new Map<string, Array<{ minutes: number; pixel: Rgba | null }>>(
      nearest.map((shelter) => [shelter.id, []]),
    );
    const activeShelterIds = new Set(nearest.map((shelter) => shelter.id));
    setShelterFloodTimings(Object.fromEntries(
      nearest.map((shelter) => [shelter.id, {
        shelterId: shelter.id,
        status: "loading" as const,
        firstFloodedMinutes: null,
        depthClass: null,
        checkedSteps: 0,
        failedSteps: 0,
      }]),
    ));

    const run = async () => {
      for (const minutes of officialSteps) {
        if (controller.signal.aborted || !activeShelterIds.size) return;
        const template = buildShinsuiTileTemplate(selectedBreakpoint, minutes);
        const requests = groupShelterTileRequests(
          nearest
            .filter((shelter) => activeShelterIds.has(shelter.id))
            .map((shelter) => ({ shelterId: shelter.id, lat: shelter.lat, lng: shelter.lng })),
          template,
          SHELTER_ANALYSIS_ZOOM,
        );

        for (let index = 0; index < requests.length; index += 4) {
          const batch = requests.slice(index, index + 4);
          const results = await Promise.all(batch.map(async (request) => ({
            request,
            pixels: await loadTilePixels(request.url),
          })));
          if (controller.signal.aborted) return;
          for (const { request, pixels } of results) {
            for (const target of request.targets) {
              let pixel: Rgba | null = null;
              if (pixels) {
                const pixelIndex = (target.pixelY * TILE_SIZE + target.pixelX) * 4;
                pixel = [
                  pixels[pixelIndex],
                  pixels[pixelIndex + 1],
                  pixels[pixelIndex + 2],
                  pixels[pixelIndex + 3],
                ];
              }
              samples.get(target.shelterId)?.push({ minutes, pixel });
            }
          }
        }

        const completed: Record<string, ShelterFloodTiming> = {};
        for (const shelterId of activeShelterIds) {
          const timing = summarizeShelterFloodTiming(
            shelterId,
            samples.get(shelterId) ?? [],
            officialSteps.length,
          );
          if (timing.firstFloodedMinutes !== null) {
            completed[shelterId] = timing;
            activeShelterIds.delete(shelterId);
          }
        }
        if (Object.keys(completed).length) {
          setShelterFloodTimings((current) => ({ ...current, ...completed }));
        }
      }

      if (controller.signal.aborted) return;
      const finalResults = Object.fromEntries([...activeShelterIds].map((shelterId) => [
        shelterId,
        summarizeShelterFloodTiming(
          shelterId,
          samples.get(shelterId) ?? [],
          officialSteps.length,
        ),
      ]));
      setShelterFloodTimings((current) => ({ ...current, ...finalResults }));
    };

    void run();
    return () => controller.abort();
  }, [mode, nearest, selectedBreakpoint]);

  const activeFrequencyScenario = FREQUENCY_SCENARIOS.find(
    (scenario) => scenario.period === period,
  ) as FloodFrequencyScenario;
  const activeFrequencyDocumentSource = activeFrequencyScenario.period === "maximum"
    ? HAZARD_PORTAL_SOURCE
    : frequencyDocumentSourceName(activeFrequencyScenario);
  const activeFrequencyMapSource = frequencyMapSourceName(activeFrequencyScenario);
  const activeMapSourceName = mode === "time" ? SHINSUI_NAVI_SOURCE : activeFrequencyMapSource;
  const selectedFrequencyAnalysis =
    period === 200 ? plan200 : period === "maximum" ? maximum : null;
  const selectedFrequencyDepthClass = selectedFrequencyAnalysis?.pointDepthClass ?? null;
  const selectedFrequencyDepthMeters = selectedFrequencyDepthClass?.maxDepthMeters ?? null;
  const displayedDepthMeters = mode === "time" ? currentDepth : selectedFrequencyDepthMeters;
  const threeDDepthLabel = mode === "time"
    ? currentDepth === null ? "確認できません" : `${currentDepth.toFixed(1)} m`
    : selectedFrequencyDepthClass?.label ?? "確認できません";
  const threeDScenarioLabel = mode === "time"
    ? selectedBreakpoint ? `破堤後 ${formatMinutes(currentMinutes)}` : "時間変化データを確認中"
    : `${activeFrequencyScenario.label}規模`;

  const overlay = useMemo(() => {
    if (mode === "frequency") {
      return FREQUENCY_SCENARIOS.find((scenario) => scenario.period === period)?.tileTemplate ?? null;
    }
    if (!selectedBreakpoint || !Number.isFinite(currentMinutes)) return null;
    return buildShinsuiTileTemplate(selectedBreakpoint, currentMinutes);
  }, [currentMinutes, mode, period, selectedBreakpoint]);

  useEffect(() => {
    if (!overlay && flood3DMode === "depth-grid") setFlood3DMode("official");
  }, [flood3DMode, overlay]);

  const mapDataStatus: MapDataStatus | null = mode === "frequency"
    ? activeFrequencyScenario.evidenceLevel === "municipality"
      ? {
          label: "板橋区が対象",
          note: activeFrequencyScenario.itabashiIncluded
            ? "板橋区が対象市区町として記載されています。"
            : "板橋区は対象市区町として記載されていません。",
          tone: "regional",
        }
      : selectedFrequencyAnalysis?.status === "available"
        ? {
            label: "地点の水深まで確認可能",
            note: activeFrequencyMapSource,
            tone: "available",
          }
        : selectedFrequencyAnalysis?.status === "loading"
          ? {
              label: `${activeFrequencyMapSource}を読み込み中`,
              note: "選択地点と800m圏内を確認しています。",
              tone: "regional",
            }
          : {
              label: `${activeFrequencyMapSource}を読み込めません`,
              note: "この表示だけでは、浸水なしとは判断できません。",
              tone: "unavailable",
            }
    : selectedBreakpoint && overlay
      ? {
          label: "対象地域全体の時間変化",
          note: `${SHINSUI_NAVI_SOURCE}・破堤後${formatMinutes(currentMinutes)}`,
          tone: "available",
        }
      : breakpointStatus === "loading"
        ? {
            label: `${SHINSUI_NAVI_SOURCE}を読み込み中`,
            note: "破堤ケースと時点データを確認しています。",
            tone: "regional",
          }
        : {
            label: `${SHINSUI_NAVI_SOURCE}を読み込めません`,
            note: "この表示だけでは、浸水なしとは判断できません。",
            tone: "unavailable",
          };

  const mapCredit = mode === "frequency" && period === 200
    ? `地理院地図・${PLAN_SCALE_MAP_SOURCE}`
    : mode === "time"
      ? `地理院地図・${SHINSUI_NAVI_SOURCE}`
      : `地理院地図・${activeFrequencyMapSource}`;

  const diagnosis = mode === "frequency"
    ? buildFrequencyHeadline({
        insideRegion: isInsideRegion(place),
        status: plan200.status,
        pointDepthLabel: plan200.pointDepthClass?.label ?? null,
        sourceName: PLAN_SCALE_MAP_SOURCE,
      })
    : buildTimeHeadline({
        insideRegion: isInsideRegion(place),
        breakpointStatus,
        hydroStatus,
        selectedBreakpoint,
        currentMinutes,
        currentDepthMeters: currentDepth,
        summary: hydroSummary,
      });
  const selectedBreakpointDescription = selectedBreakpoint
    ? describeBreakPointCase(selectedBreakpoint)
    : null;

  const frequencyPointValue = activeFrequencyScenario.evidenceLevel === "municipality"
    ? activeFrequencyScenario.itabashiIncluded
      ? "この地点の浸水深は公開されていません"
      : "板橋区は含まれません"
    : selectedFrequencyAnalysis?.status === "loading"
      ? "確認中"
      : selectedFrequencyDepthClass?.label ?? "区分を確認できません";
  const frequencyPointNote = activeFrequencyScenario.evidenceLevel === "municipality"
    ? activeFrequencyScenario.itabashiIncluded
      ? "板橋区が対象市区町として記載されています"
      : "板橋区は対象市区町として記載されていません"
    : selectedFrequencyDepthClass
      ? heightComparison(selectedFrequencyDepthClass.maxDepthMeters)
      : selectedFrequencyAnalysis?.status === "loading"
        ? `${activeFrequencyMapSource}を読み込んでいます`
        : "この表示だけでは、浸水なしとは判断できません";
  const frequencyCoverageValue = activeFrequencyScenario.evidenceLevel === "municipality"
    ? "算出しません"
    : selectedFrequencyAnalysis?.coveragePercent === null
      ? "—"
      : `${selectedFrequencyAnalysis?.coveragePercent}%`;
  const frequencyCoverageNote = activeFrequencyScenario.evidenceLevel === "municipality"
    ? "地点ごとの浸水範囲が公開されていないため"
    : selectedFrequencyAnalysis?.status === "available"
      ? `${activeFrequencyMapSource}から計算した目安`
      : "この表示だけでは、浸水なしとは判断できません";
  const frequencyScopeValue = activeFrequencyScenario.evidenceLevel === "municipality"
    ? "板橋区が対象かどうか"
    : selectedFrequencyAnalysis?.status === "available"
      ? "地点の水深まで確認"
      : "出典ページで確認";
  const frequencyScopeNote = activeFrequencyScenario.evidenceLevel === "municipality"
    ? activeFrequencyDocumentSource
    : activeFrequencyMapSource;
  const frequencySourceNote = activeFrequencyScenario.evidenceLevel === "municipality"
    ? activeFrequencyScenario.itabashiIncluded
      ? "板橋区が対象市区町として記載されています。この地点の浸水深と800m圏内の割合は公開されていません。"
      : "板橋区は対象市区町として記載されていません。これは、この地点に浸水リスクがないという意味ではありません。"
    : period === 200
      ? `${PLAN_SCALE_MAP_SOURCE}を参考表示しています。1年あたり0.5%の確率・72時間雨量516mmという条件は同じですが、2022年の「国管理河川の浸水想定図（1/200規模降雨）」とは別に公表された地図です。`
      : `${HAZARD_PORTAL_SOURCE}に掲載された、水防法に基づく想定最大規模の浸水想定です。頻度別の最大浸水とは別のデータです。`;

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearchMessage("検索中…");
    setSearchResults([]);
    try {
      const response = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("failed");
      const features = (await response.json()) as SearchFeature[];
      const results = features.slice(0, 12).map((feature) => ({
        title: feature.properties.title,
        lng: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1],
      }));
      const inside = results.filter(isInsideRegion).slice(0, 5);
      setSearchResults(inside);
      setSearchMessage(inside.length ? "" : "対象地域内の候補がありません。高島平・舟渡周辺を検索してください。");
    } catch {
      setSearchMessage("検索できませんでした。地図をタップして地点を選べます。");
    }
  }

  function choosePlace(next: Place) {
    setPlace(next);
    setViewScope("local");
    setSelectedShelterId(null);
    setSearchResults([]);
    setSearchMessage(isInsideRegion(next) ? "" : "対象地域外です。この版では高島平・舟渡のみ診断します。");
  }

  function toggleShelterMarker(shelterId: string) {
    setSelectedShelterId((current) => current === shelterId ? null : shelterId);
  }

  function focusShelterOnMap(shelterId: string) {
    setShowShelters(true);
    setSelectedShelterId(shelterId);
    window.setTimeout(() => {
      mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  function focusShelterInList(shelterId: string) {
    setSelectedShelterId(shelterId);
    window.setTimeout(() => {
      shelterCardRefs.current[shelterId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  return (
    <main>
      <div className="rain" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top"><span>街の弱点</span><small>高島平・舟渡 水害編</small></a>
        <a className="current-risk" href="https://www.jma.go.jp/bosai/risk/" target="_blank" rel="noreferrer">
          <span>現在の危険度</span><strong>キキクルで確認 ↗</strong>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">TAKASHIMADAIRA / FUNADO · FLOOD STUDY</div>
        <h1>
          <span className="hero-line">雨の規模と、</span>
          <span className="hero-line hero-line-long">
            <span>浸水が始まる</span><span>時間を見る。</span>
          </span>
        </h1>
        <p className="hero-copy">ランキングではなく、この場所で「どれくらい深く」「いつ始まり」「どのくらい続くか」を読み解きます。</p>
        <form className="search-box" onSubmit={handleSearch}>
          <label htmlFor="place-search">高島平・舟渡の駅・住所・施設</label>
          <div><input id="place-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：高島平駅、舟渡小学校" /><button type="submit">調べる</button></div>
        </form>
        {searchResults.length > 0 && (
          <div className="search-results">{searchResults.map((result) => <button key={`${result.lat}-${result.lng}`} onClick={() => choosePlace(result)}>{result.title}<span>この地点を見る</span></button>)}</div>
        )}
        {searchMessage && <p className="search-message">{searchMessage}</p>}
        <p className="map-hint">または地図をタップして地点を選択</p>
      </section>

      <section className="diagnosis section-rule">
        <div className="section-no">01</div>
        <div>
          <p className="location-name">{place.title}</p>
          <h2>{diagnosis.headline}</h2>
          <p>{diagnosis.note}</p>
        </div>
      </section>

      <section className="explorer section-rule" ref={mapSectionRef}>
        <div className="section-head">
          <div><span className="section-no">02</span><p>洪水を、規模と時間の二つの観点から見る</p></div>
          <div className="mode-switch" role="tablist">
            <button className={mode === "frequency" ? "active" : ""} onClick={() => setMode("frequency")}>頻度から見る</button>
            <button className={mode === "time" ? "active" : ""} onClick={() => setMode("time")}>時間から見る</button>
          </div>
        </div>

        {mode === "frequency" ? (
          <div className="scenario-panel">
            <div className="scenario-copy">
              <span className="kicker">FREQUENCY</span>
              <h3>どの規模の雨で、この地点に<br />浸水想定が重なるか</h3>
              <p>「1/30」は、1年あたり約3.3%の確率で、その規模を上回る雨が起きることを表します。30年ごとに必ず起きる意味ではありません。</p>
            </div>
            <div className="periods" aria-label="降雨規模">
              {FREQUENCY_SCENARIOS.map((scenario) => (
                <button key={scenario.label} className={period === scenario.period ? "active" : ""} aria-pressed={period === scenario.period} onClick={() => setPeriod(scenario.period)}>
                  <strong>{scenario.label}</strong><small>{scenario.period === "maximum" ? "水防法に基づく想定" : `1年あたり${(scenario.annualProbability! * 100).toFixed(scenario.period === 10 ? 0 : 1)}%の確率`}</small>
                </button>
              ))}
            </div>
            <div className="metrics-grid">
              <article><span>選択地点</span><strong>{frequencyPointValue}</strong><small>{frequencyPointNote}</small></article>
              <article><span>800m圏内の浸水想定</span><strong>{frequencyCoverageValue}</strong><small>{frequencyCoverageNote}</small></article>
              <article><span>この画面で確認できること</span><strong>{frequencyScopeValue}</strong><small>{frequencyScopeNote}</small></article>
            </div>
            <div className="frequency-source">
              <div>
                <span>OFFICIAL SOURCE</span>
                <strong>{activeFrequencyDocumentSource}</strong>
                <p>{frequencySourceNote}</p>
                {activeFrequencyScenario.rainfall72hMm !== null && (
                  <small>荒川流域の72時間総雨量 {activeFrequencyScenario.rainfall72hMm}mm</small>
                )}
              </div>
              <div className="frequency-source-links">
                <a href={activeFrequencyScenario.sourceUrl} target="_blank" rel="noreferrer">浸水想定図を開く ↗</a>
                {activeFrequencyScenario.referenceUrl && (
                  <a href={activeFrequencyScenario.referenceUrl} target="_blank" rel="noreferrer">計画規模の公開地図を開く ↗</a>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="scenario-panel time-panel">
            <div className="scenario-copy"><span className="kicker">TIMELINE</span><h3>堤防が決壊した後、<br />浸水はどう広がるか</h3><p>{SHINSUI_NAVI_SOURCE}が示す、想定最大規模の破堤ケースです。頻度別の雨を補間したものではありません。</p></div>
            <div className="case-switch">
              {([ ["start", "最も早く到達"], ["depth", "最も深くなる"], ["duration", "最も長く続く"] ] as const).map(([key, label]) => (
                <button key={key} className={scenarioKind === key ? "active" : ""} onClick={() => setScenarioKind(key)}>{label}</button>
              ))}
            </div>
            {breakpointStatus === "loading" && <div className="data-gap"><strong>{SHINSUI_NAVI_SOURCE}から破堤ケースを読み込み中…</strong></div>}
            {(breakpointStatus === "error" || breakpointStatus === "limited") && <div className="data-gap"><strong>公式データを読み込めません。</strong><p>{breakpointStatus === "limited" ? "利用制限を守るため、少し時間をおいてから、もう一度お試しください。この表示だけでは、浸水なしとは判断できません。" : "通信が一時的に失敗した可能性があります。この表示だけでは、浸水なしとは判断できません。"}</p><button type="button" onClick={() => setBreakpointReload((value) => value + 1)}>もう一度読み込む</button></div>}
            {breakpointStatus === "empty" && <div className="data-gap"><strong>この地点の破堤ケースを確認できません。</strong><p>対象外またはデータ未整備の可能性があります。この表示だけでは、浸水なしとは判断できません。</p></div>}
            {breakpointFreshness?.stale && (
              <div className="stale-data-notice">
                {SHINSUI_NAVI_SOURCE}を読み込めないため、{formatFetchedAt(breakpointFreshness.fetchedAt)}に取得した破堤ケースを表示しています。
              </div>
            )}
            {selectedBreakpoint && (
              <>
                <div className="breakpoint-line">
                  <span>選択ケース</span>
                  <strong>
                    {selectedBreakpointDescription?.displayLabel || selectedBreakpoint.BPLocation}
                    {`（${selectedBreakpoint.BPName}）`}
                  </strong>
                  <small>この地点は、時系列シミュレーションの計算条件です</small>
                </div>
                <div className="timeline-control">
                  <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? "停止" : "再生"}</button>
                  <input type="range" min="0" max={Math.max(0, timeSteps.length - 1)} value={timeIndex} onChange={(event) => { setPlaying(false); setTimeIndex(Number(event.target.value)); }} aria-label="破堤後の時間" />
                  <strong>破堤後 {formatMinutes(currentMinutes)}</strong>
                </div>
                {hydroStatus === "loading" ? <div className="empty-chart">水深グラフを読み込み中…</div> : hydroStatus === "error" ? <div className="data-gap hydro-gap"><strong>水深の時間変化を読み込めません。</strong><p>{SHINSUI_NAVI_SOURCE}との通信が一時的に失敗した可能性があります。この表示だけでは、浸水なしとは判断できません。</p><button type="button" onClick={() => setHydroReload((value) => value + 1)}>もう一度読み込む</button></div> : <Hydrograph points={hydrograph} currentMinutes={currentMinutes} />}
                {hydroFreshness?.stale && (
                  <div className="stale-data-notice">
                    水深グラフは{formatFetchedAt(hydroFreshness.fetchedAt)}に取得したデータです。
                  </div>
                )}
                <div className="metrics-grid time-metrics">
                  <article><span>浸水開始</span><strong>{formatMinutes(hydroSummary.startMinutes)}</strong></article>
                  <article><span>最大水深</span><strong>{hydroSummary.maxDepthMeters === null ? "—" : `${hydroSummary.maxDepthMeters.toFixed(1)}m`}</strong></article>
                  <article><span>浸水が続く時間</span><strong>{formatMinutes(hydroSummary.durationMinutes)}</strong></article>
                  <article><span>この時点の水深</span><strong>{currentDepth === null ? "—" : `${currentDepth.toFixed(1)}m`}</strong></article>
                </div>
              </>
            )}
          </div>
        )}

        <div className="map-toolbar">
          <div>
            <strong>{view3d ? "3D浸水地図" : "2D浸水地図"}</strong>
            <span>{view3d ? `PLATEAU地形・建物・${activeMapSourceName}の浸水を重ねます` : "地図をタップすると地点を変更できます"}</span>
          </div>
          <div className="map-toolbar-actions">
            <div className="map-option-switch" role="group" aria-label="地図の表示範囲">
              <button type="button" className={viewScope === "district" ? "active" : ""} onClick={() => setViewScope("district")}>対象地域全体</button>
              <button type="button" className={viewScope === "local" ? "active" : ""} onClick={() => setViewScope("local")}>選択地点から800m</button>
            </div>
            <div className="map-option-switch" role="group" aria-label="避難場所の表示">
              <button type="button" className={showShelters ? "active" : ""} aria-pressed={showShelters} onClick={() => setShowShelters(true)}>洪水時の避難場所を表示</button>
              <button type="button" className={!showShelters ? "active" : ""} aria-pressed={!showShelters} onClick={() => { setShowShelters(false); setSelectedShelterId(null); }}>避難場所を隠す</button>
            </div>
            {view3d && (
              <div className="map-option-switch" role="group" aria-label="3D浸水の表現" aria-describedby="flood-3d-mode-help">
                <button type="button" className={flood3DMode === "official" ? "active" : ""} onClick={() => setFlood3DMode("official")}>公式地図を重ねる</button>
                <button type="button" className={flood3DMode === "depth-grid" ? "active" : ""} disabled={!overlay} onClick={() => setFlood3DMode("depth-grid")}>水深を立体で見る（概算）</button>
              </div>
            )}
            <button className="map-view-toggle" type="button" onClick={() => setView3d((value) => !value)}>{view3d ? "2Dに戻す" : "3Dで見る"}</button>
          </div>
        </div>
        {view3d && (
          <details className="map-mode-help" id="flood-3d-mode-help">
            <summary>浸水の見せ方を選ぶ</summary>
            <div>
              <p><strong>公式地図を重ねる</strong>現在選んでいる{activeMapSourceName}の浸水範囲を地形に重ねて見ます。</p>
              <p><strong>水深を立体で見る（概算）</strong>水深区分を高さのあるブロックで表します。水の流れを再現するものではありません。</p>
            </div>
          </details>
        )}
        {view3d ? (
          <CesiumFloodView
            lat={place.lat}
            lng={place.lng}
            depthMeters={displayedDepthMeters}
            depthLabel={threeDDepthLabel}
            scenarioLabel={threeDScenarioLabel}
            sourceName={activeMapSourceName}
            overlayTemplate={overlay}
            viewScope={viewScope}
            flood3DMode={flood3DMode}
            regionBounds={REGION_BOUNDS}
            nearestShelters={nearest}
            shelterFloodTimings={shelterFloodTimings}
            currentMinutes={currentMinutes}
            mode={mode}
            showShelters={showShelters}
            shelterDataStatus={shelterDataStatus}
            selectedBreakpoint={selectedBreakpoint}
            selectedShelterId={selectedShelterId}
            onMarkerSelect={toggleShelterMarker}
            onViewInList={focusShelterInList}
          />
        ) : (
          <FloodMap
            place={place}
            overlay={overlay}
            onSelect={choosePlace}
            dataStatus={mapDataStatus}
            credit={mapCredit}
            viewScope={viewScope}
            mode={mode}
            nearestShelters={nearest}
            shelterFloodTimings={shelterFloodTimings}
            currentMinutes={currentMinutes}
            showShelters={showShelters}
            shelterDataStatus={shelterDataStatus}
            selectedBreakpoint={selectedBreakpoint}
            selectedShelterId={selectedShelterId}
            onMarkerSelect={toggleShelterMarker}
            onViewInList={focusShelterInList}
            mapRef={mapWrapRef}
          />
        )}
      </section>

      <section className="depth-story section-rule">
        <div className="section-head simple"><div><span className="section-no">03</span><p>深さを人や建物と比べる</p></div></div>
        <div className="depth-layout">
          <div className="depth-figure"><div className="building"><span>3F</span><span>2F</span><span>1F</span></div><div className="person">●<i /></div><div className="water" style={{ height: displayedDepthMeters === null ? "0%" : `${Math.min(92, Math.max(5, displayedDepthMeters / 6 * 92))}%` }} /></div>
          <div className="depth-copy"><span>{mode === "time" ? `破堤後${formatMinutes(currentMinutes)}時点の水深区分` : "この地点の水深区分"}</span><strong>{mode === "time" ? (currentDepth === null ? "確認できません" : `${currentDepth.toFixed(1)} m`) : selectedFrequencyDepthClass?.label ?? "確認できません"}</strong><h3>{heightComparison(displayedDepthMeters)}</h3><p>{mode === "frequency" && selectedFrequencyDepthClass ? "水深区分の上限値を使った目安として表示しています。" : ""} 建物の形や地盤高によって実際の水位は異なります。階数との比較は理解のための目安です。</p></div>
        </div>
      </section>

      <section className="shelters section-rule">
        <div className="section-head simple"><div><span className="section-no">04</span><p>洪水時の指定緊急避難場所（最寄り3件）</p></div></div>
        <p className="section-intro">洪水時に、命を守るため緊急的に避難する場所として登録された施設です。実際に開設される避難先や、安全な避難経路を示すものではありません。距離は直線距離です。</p>
        <div className="shelter-list">
          {nearest.length ? nearest.map((shelter, index) => (
            <article
              key={shelter.id}
              id={`shelter-${shelter.id}`}
              ref={(element) => { shelterCardRefs.current[shelter.id] = element; }}
              className={selectedShelterId === shelter.id ? "highlighted" : ""}
            >
              <span className="rank">0{index + 1}</span><div><h3>{shelter.name}</h3><p>{shelter.address}</p><strong>{shelter.distanceMeters < 1000 ? `${shelter.distanceMeters}m` : `${(shelter.distanceMeters / 1000).toFixed(1)}km`}（直線）</strong>{mode === "time" ? selectedBreakpoint ? <ShelterFloodBadge timing={shelterFloodTimings[shelter.id]} /> : <div className="shelter-flood-badge unavailable"><strong>{breakpointStatus === "loading" ? "浸水開始時刻を確認中" : "公式データを読み込めないため、浸水開始時刻を判定できません"}</strong>{breakpointStatus !== "loading" && <small>この表示だけでは、浸水なしとは判断できません</small>}</div> : <small>周辺の浸水状況：現在選んでいる地図で確認してください</small>}</div>
              <div className="shelter-list-actions">
                <button type="button" onClick={() => focusShelterOnMap(shelter.id)}>地図で見る</button>
                <a href={`https://www.google.com/maps/dir/?api=1&origin=${place.lat},${place.lng}&destination=${shelter.lat},${shelter.lng}&travelmode=walking`} target="_blank" rel="noreferrer">平常時の徒歩経路 ↗</a>
              </div>
            </article>
          )) : <div className="data-gap"><strong>避難場所データを読み込めません。</strong><p>国土地理院の指定緊急避難場所データを確認してください。</p></div>}
        </div>
        {mode === "time" && <p className="route-note shelter-timing-note">施設の代表地点を、{SHINSUI_NAVI_SOURCE}で確認した結果です。道路や徒歩経路の安全性、実際の浸水到達時刻を保証するものではありません。</p>}
        <p className="route-note">Google Mapsの経路は平常時の参考です。浸水時に安全な避難ルートとは判定していません。実際の避難は板橋区・気象庁の情報に従ってください。</p>
      </section>

      <section className="official section-rule">
        <div className="section-head simple"><div><span className="section-no">05</span><p>公式情報を確認する</p></div></div>
        <div className="official-grid">
          <a href="https://www.jma.go.jp/bosai/risk/" target="_blank" rel="noreferrer"><span>NOW</span><strong>気象庁キキクル</strong><small>いまの危険度を確認 ↗</small></a>
          <a href="https://suiboumap.gsi.go.jp/" target="_blank" rel="noreferrer"><span>TIME</span><strong>国土地理院 浸水ナビ</strong><small>地点別シミュレーション ↗</small></a>
          <a href={FREQUENCY_ORIGINALS} target="_blank" rel="noreferrer"><span>FREQUENCY</span><strong>荒川下流河川事務所</strong><small>多段階浸水想定図 ↗</small></a>
          <a href="https://www.city.itabashi.tokyo.jp/bousai/bousai/map/1005742.html" target="_blank" rel="noreferrer"><span>LOCAL</span><strong>板橋区 洪水ハザードマップ</strong><small>自治体の避難情報 ↗</small></a>
        </div>
      </section>

      <footer>
        <div><strong>街の弱点</strong><span>高島平・舟渡 水害編</span></div>
        <div className="footer-notes"><p><b>データ</b> 国土地理院「ハザードマップポータル」「浸水ナビ」「指定緊急避難場所データ」、国土交通省 関東地方整備局「国管理河川の浸水想定図」、荒川下流河川事務所「計画規模の浸水想定図」、国土交通省「PLATEAU建物・PLATEAU-Terrain」。避難場所データ更新日：2025-03-31。</p><p><b>計算</b> 1/200規模と想定最大規模では、選択地点から800m圏内の浸水想定割合を、地図を一定間隔で読み取って目安として計算しています。水深の立体表示は約50〜100m四方の区画で表し、公開されていない途中時刻は補いません。1/10〜1/100は、地点ごとの浸水深や周辺割合を算出できません。</p><p><b>免責</b> 本サイトは学習・事前確認用です。実際の避難判断には気象庁、板橋区、国土交通省等の最新情報を必ず確認してください。水深の立体表示は、連続した水面や水の流れを再現するものではありません。</p></div>
      </footer>
    </main>
  );
}
