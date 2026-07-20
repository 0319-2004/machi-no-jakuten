export type Coordinate = { lat: number; lng: number };

export type RegionBounds = {
  west: number;
  east: number;
  south: number;
  north: number;
};

export type ViewScope = "district" | "local";
export type Flood3DMode = "official" | "depth-grid";
export type TerrainStatus = "loading" | "ready" | "fallback";

export type ReturnPeriod = 10 | 30 | 50 | 100 | 200 | "maximum";

export type FrequencyEvidenceLevel = "municipality" | "official-tile" | "maximum-tile";

export type FloodFrequencyScenario = {
  period: ReturnPeriod;
  label: string;
  annualProbability: number | null;
  evidenceLevel: FrequencyEvidenceLevel;
  itabashiIncluded: boolean | null;
  rainfall72hMm: number | null;
  tileTemplate: string | null;
  sourceUrl: string;
  referenceUrl: string | null;
  sourcePublishedAt: string;
};

export type BreakPointScenario = {
  ID: string;
  BPName: string;
  BPLocation: string;
  BPLat: number;
  BPLon: number;
  EntryRiverName: string;
  RiverCode: string;
  SubRiverCode: string;
  CSVScale: number;
  OfficeCode: string;
  BPTime: number[];
  isDepthMax: boolean;
  isStartMax: boolean;
  isDurationMax: boolean;
};

export type BreakPointLocationInfo = {
  bank: "left" | "right" | null;
  distanceLabel: string | null;
  raw: string;
};

export type BreakPointCaseDescription = BreakPointLocationInfo & {
  riverName: string;
  bankLabel: "左岸" | "右岸" | null;
  caseId: string;
  locationLabel: string;
  displayLabel: string;
};

export type DiagnosisCopy = {
  headline: string;
  note: string;
};

export type FrequencyHeadlineInput = {
  insideRegion: boolean;
  status: "loading" | "available" | "unavailable";
  pointDepthLabel: string | null;
  sourceName: string;
};

export type TimeHeadlineInput = {
  insideRegion: boolean;
  breakpointStatus: "idle" | "loading" | "ready" | "empty" | "error" | "limited";
  hydroStatus: "idle" | "loading" | "ready" | "error";
  selectedBreakpoint: BreakPointScenario | null | undefined;
  currentMinutes: number;
  currentDepthMeters: number | null;
  summary: HydrographSummary;
};

export type CoordinateDirection = {
  arrow: "↑" | "↗" | "→" | "↘" | "↓" | "↙" | "←" | "↖";
  compassLabel: "北" | "北東" | "東" | "南東" | "南" | "南西" | "西" | "北西";
  distanceMeters: number;
  distanceLabel: string;
};

export type HydrographPoint = { hours: number; depthMeters: number };

export type HydrographSummary = {
  startMinutes: number | null;
  maxDepthMeters: number | null;
  maxDepthAtMinutes: number | null;
  durationMinutes: number | null;
};

export type FloodShelter = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  supportsFlood: boolean;
  note?: string;
};

export type FloodShelterDistance = FloodShelter & { distanceMeters: number };

export type ShelterFloodTimingStatus =
  | "loading"
  | "flooded"
  | "not-flooded"
  | "partial"
  | "unavailable";

export type ShelterFloodSample = {
  minutes: number;
  pixel: Rgba | null;
};

export type ShelterFloodTiming = {
  shelterId: string;
  status: ShelterFloodTimingStatus;
  firstFloodedMinutes: number | null;
  depthClass: DepthClass | null;
  checkedSteps: number;
  failedSteps: number;
};

export type ShelterTileTarget = Coordinate & { shelterId: string };

export type ShelterTileRequest = {
  url: string;
  targets: Array<{
    shelterId: string;
    pixelX: number;
    pixelY: number;
  }>;
};

export type SelectedLocationSummary = {
  location: Coordinate;
  pointDepthMeters: number | null;
  coverage800mPercent: number | null;
  dataStatus: "available" | "outside" | "unavailable";
};

export const REGION_BOUNDS: RegionBounds = {
  west: 139.62,
  east: 139.7,
  south: 35.765,
  north: 35.815,
} as const;

export const FREQUENCY_SCENARIOS: readonly FloodFrequencyScenario[] = [
  {
    period: 10,
    label: "1/10",
    annualProbability: 0.1,
    evidenceLevel: "municipality",
    itabashiIncluded: false,
    rainfall72hMm: 299,
    tileTemplate: null,
    sourceUrl: "https://www.ktr.mlit.go.jp/ktr_content/content/000838175.pdf",
    referenceUrl: null,
    sourcePublishedAt: "2022-08-31",
  },
  {
    period: 30,
    label: "1/30",
    annualProbability: 1 / 30,
    evidenceLevel: "municipality",
    itabashiIncluded: false,
    rainfall72hMm: 380,
    tileTemplate: null,
    sourceUrl: "https://www.ktr.mlit.go.jp/ktr_content/content/000838177.pdf",
    referenceUrl: null,
    sourcePublishedAt: "2022-08-31",
  },
  {
    period: 50,
    label: "1/50",
    annualProbability: 0.02,
    evidenceLevel: "municipality",
    itabashiIncluded: true,
    rainfall72hMm: 417,
    tileTemplate: null,
    sourceUrl: "https://www.ktr.mlit.go.jp/ktr_content/content/000838178.pdf",
    referenceUrl: null,
    sourcePublishedAt: "2022-08-31",
  },
  {
    period: 100,
    label: "1/100",
    annualProbability: 0.01,
    evidenceLevel: "municipality",
    itabashiIncluded: true,
    rainfall72hMm: 467,
    tileTemplate: null,
    sourceUrl: "https://www.ktr.mlit.go.jp/ktr_content/content/000838179.pdf",
    referenceUrl: null,
    sourcePublishedAt: "2022-08-31",
  },
  {
    period: 200,
    label: "1/200",
    annualProbability: 0.005,
    evidenceLevel: "official-tile",
    itabashiIncluded: true,
    rainfall72hMm: 516,
    tileTemplate:
      "https://tiles-ap1.arcgis.com/PZQkxlojiiLRSa6b/arcgis/rest/services/Arakawa_keikakukibo/MapServer/tile/{z}/{y}/{x}",
    sourceUrl: "https://www.ktr.mlit.go.jp/ktr_content/content/000838180.pdf",
    referenceUrl: "https://arage.maps.arcgis.com/home/item.html?id=84e896aa9959412998e4da1edaa69dd9",
    sourcePublishedAt: "2022-08-31",
  },
  {
    period: "maximum",
    label: "想定最大",
    annualProbability: null,
    evidenceLevel: "maximum-tile",
    itabashiIncluded: true,
    rainfall72hMm: 632,
    tileTemplate:
      "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
    sourceUrl: "https://disaportal.gsi.go.jp/",
    referenceUrl: null,
    sourcePublishedAt: "2016-05-30",
  },
] as const;

export type DepthClass = {
  rgb: readonly [number, number, number];
  level: number;
  label: string;
  minDepthMeters: number;
  maxDepthMeters: number;
};

export const OFFICIAL_DEPTH_CLASSES: readonly DepthClass[] = [
  { rgb: [255, 255, 179], level: 1, label: "0.1〜0.3m", minDepthMeters: 0.1, maxDepthMeters: 0.3 },
  { rgb: [247, 245, 169], level: 1, label: "0.1〜0.5m", minDepthMeters: 0.1, maxDepthMeters: 0.5 },
  { rgb: [248, 225, 166], level: 2, label: "0.5〜1m", minDepthMeters: 0.5, maxDepthMeters: 1 },
  { rgb: [255, 216, 192], level: 3, label: "0.5〜3m", minDepthMeters: 0.5, maxDepthMeters: 3 },
  { rgb: [255, 183, 183], level: 4, label: "3〜5m", minDepthMeters: 3, maxDepthMeters: 5 },
  { rgb: [255, 145, 145], level: 5, label: "5〜10m", minDepthMeters: 5, maxDepthMeters: 10 },
  { rgb: [242, 133, 201], level: 6, label: "10〜20m", minDepthMeters: 10, maxDepthMeters: 20 },
  { rgb: [220, 122, 220], level: 7, label: "20m以上", minDepthMeters: 20, maxDepthMeters: 20 },
] as const;

export type Rgba = readonly [number, number, number, number];

export type FloodSampleSummary = {
  pointDepthClass: DepthClass | null;
  coveredPoints: number;
  sampledPoints: number;
  coveragePercent: number | null;
};

export type FloodGridPoint = Coordinate & {
  cellSizeMeters: number;
};

export type TilePixelCoordinate = {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
};

export function fillTileTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

export function shinsuiRainfallScale(csvScale: number): "L1" | "L1b" | "L2" {
  if (csvScale === 1) return "L1";
  if (csvScale === -1) return "L1b";
  return "L2";
}

export function extendedRiverCode(riverCode: string, subRiverCode: string): string {
  return !subRiverCode || subRiverCode === "_"
    ? riverCode
    : `${riverCode}${subRiverCode}`;
}

/** 浸水ナビ仕様に沿った破堤点別時系列タイルURL。経過時間は必ず5桁。 */
export function buildShinsuiTileTemplate(
  scenario: Pick<
    BreakPointScenario,
    "BPName" | "CSVScale" | "OfficeCode" | "RiverCode" | "SubRiverCode"
  >,
  minutes: number,
): string {
  const scale = shinsuiRainfallScale(scenario.CSVScale);
  const riverCode = extendedRiverCode(scenario.RiverCode, scenario.SubRiverCode);
  const time = Math.max(0, Math.round(minutes)).toString().padStart(5, "0");
  return `https://suiboumap.gsi.go.jp/shinsuimap/Tile/${scenario.OfficeCode}/${scale}/${riverCode}/${scenario.BPName}/${scenario.BPName}_${time}m/{z}/{x}/{y}.png`;
}

/** 浸水ナビの距離標表記を、存在する情報だけに分ける。 */
export function parseBreakPointLocation(bpLocation: string): BreakPointLocationInfo {
  const raw = bpLocation.trim();
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*km\s+(右岸|左岸)$/i);
  if (!match) return { bank: null, distanceLabel: null, raw };
  return {
    bank: match[2] === "右岸" ? "right" : "left",
    distanceLabel: `${match[1]}km`,
    raw,
  };
}

/** 選択ケース、2D、3Dで共有する破堤ケースの表示内容。 */
export function describeBreakPointCase(
  scenario: Pick<BreakPointScenario, "BPName" | "BPLocation" | "EntryRiverName">,
): BreakPointCaseDescription {
  const location = parseBreakPointLocation(scenario.BPLocation);
  const riverName = scenario.EntryRiverName.trim();
  const bankLabel = location.bank === "right" ? "右岸" : location.bank === "left" ? "左岸" : null;
  const parsedLocation = [bankLabel, location.distanceLabel].filter(Boolean).join(" ");
  const locationLabel = parsedLocation || location.raw;
  return {
    ...location,
    riverName,
    bankLabel,
    caseId: scenario.BPName,
    locationLabel,
    displayLabel: [riverName, locationLabel].filter(Boolean).join(" "),
  };
}

export function buildFrequencyHeadline(input: FrequencyHeadlineInput): DiagnosisCopy {
  const baseNote = "荒川下流河川事務所「計画規模の浸水想定図」による参考表示です。";
  if (!input.insideRegion) {
    return { headline: "この地点は対象地域の外です。", note: baseNote };
  }
  if (input.status === "loading") {
    return { headline: "この地点のデータを確認中です。", note: baseNote };
  }
  if (input.status === "unavailable") {
    return {
      headline: `${input.sourceName}を読み込めません。`,
      note: `${baseNote} この表示だけでは、浸水なしとは判断できません。`,
    };
  }
  return {
    headline: input.pointDepthLabel
      ? `この地点では、大規模な洪水で${input.pointDepthLabel}浸水する想定です。`
      : "この地点の浸水想定は、参考表示では確認できません。",
    note: baseNote,
  };
}

export function buildTimeHeadline(input: TimeHeadlineInput): DiagnosisCopy {
  const safetyNote = "この表示だけでは、浸水なしとは判断できません。";
  if (!input.insideRegion) {
    return { headline: "この地点は対象地域の外です。", note: safetyNote };
  }
  if (input.breakpointStatus === "loading" || input.breakpointStatus === "idle") {
    return { headline: "破堤ケースを確認中です。", note: "国土地理院「浸水ナビ」の公式データを確認しています。" };
  }
  if (input.breakpointStatus === "error" || input.breakpointStatus === "limited") {
    return { headline: "公式データを読み込めません。", note: safetyNote };
  }
  if (input.breakpointStatus === "empty") {
    return { headline: "この地点の破堤ケースを確認できません。", note: safetyNote };
  }
  if (!input.selectedBreakpoint) {
    return { headline: "破堤ケースを確認中です。", note: "国土地理院「浸水ナビ」の公式データを確認しています。" };
  }

  const description = describeBreakPointCase(input.selectedBreakpoint);
  const details: string[] = [];
  if (input.summary.startMinutes !== null) {
    details.push(`浸水開始：破堤後${formatMinutes(input.summary.startMinutes)}`);
  }
  if (input.summary.maxDepthMeters !== null) {
    details.push(`この決壊ケースの最大水深：${input.summary.maxDepthMeters.toFixed(1)}m`);
  }
  const location = description.displayLabel || description.raw;
  const caseNote = location
    ? `想定上の決壊地点は、${location}です${details.length ? `（${details.join("／")}）` : ""}。`
    : details.length
      ? `${details.join("／")}。`
      : "国土地理院「浸水ナビ」の公式データによる表示です。";

  if (input.hydroStatus === "loading" || input.hydroStatus === "idle") {
    return { headline: "水深の時間変化を確認中です。", note: caseNote };
  }
  if (input.hydroStatus === "error") {
    return { headline: "水深の時間変化を読み込めません。", note: `${caseNote} ${safetyNote}` };
  }
  if (input.currentDepthMeters === null) {
    return { headline: "この時刻の水深を確認できません。", note: `${caseNote} ${safetyNote}` };
  }
  return {
    headline: `この決壊ケースでは、現在選んでいる時刻（破堤後${formatMinutes(input.currentMinutes)}）の水深は${input.currentDepthMeters.toFixed(1)}mの想定です。`,
    note: caseNote,
  };
}

export function representativeDepthMeters(depthClass: DepthClass): number {
  if (depthClass.minDepthMeters >= 20) return 20;
  return Math.round(((depthClass.minDepthMeters + depthClass.maxDepthMeters) / 2) * 100) / 100;
}

export function absoluteWaterHeight(
  groundHeightMeters: number,
  depthMeters: number | null,
): number | null {
  if (depthMeters === null || !Number.isFinite(depthMeters)) return null;
  return groundHeightMeters + Math.max(0, depthMeters);
}

export function boundsAroundPoint(
  point: Coordinate,
  radiusMeters: number,
): RegionBounds {
  const safeRadius = Math.max(0, radiusMeters);
  const latitudeDelta = safeRadius / 111_320;
  const longitudeDelta = safeRadius /
    (111_320 * Math.max(0.1, Math.cos((point.lat * Math.PI) / 180)));
  return {
    west: point.lng - longitudeDelta,
    east: point.lng + longitudeDelta,
    south: point.lat - latitudeDelta,
    north: point.lat + latitudeDelta,
  };
}

/** 描画上限を超えないよう格子を粗くし、各セル中心を返す。 */
export function buildRegionalGrid(
  bounds: RegionBounds,
  preferredCellSizeMeters: number,
  maxCells: number,
): FloodGridPoint[] {
  const midLatitude = (bounds.south + bounds.north) / 2;
  const widthMeters = haversineMeters(
    { lat: midLatitude, lng: bounds.west },
    { lat: midLatitude, lng: bounds.east },
  );
  const heightMeters = haversineMeters(
    { lat: bounds.south, lng: bounds.west },
    { lat: bounds.north, lng: bounds.west },
  );
  const preferred = Math.max(10, preferredCellSizeMeters);
  const limit = Math.max(1, Math.floor(maxCells));
  const required = Math.sqrt((widthMeters * heightMeters) / limit);
  let cellSizeMeters = Math.ceil(Math.max(preferred, required) / 10) * 10;
  let columns = Math.max(1, Math.ceil(widthMeters / cellSizeMeters));
  let rows = Math.max(1, Math.ceil(heightMeters / cellSizeMeters));
  // 端数の切り上げで上限を越えないよう、必要な場合だけさらに粗くする。
  while (columns * rows > limit) {
    cellSizeMeters += 10;
    columns = Math.max(1, Math.ceil(widthMeters / cellSizeMeters));
    rows = Math.max(1, Math.ceil(heightMeters / cellSizeMeters));
  }
  const points: FloodGridPoint[] = [];

  for (let row = 0; row < rows; row += 1) {
    const lat = bounds.south + ((row + 0.5) / rows) * (bounds.north - bounds.south);
    for (let column = 0; column < columns; column += 1) {
      const lng = bounds.west + ((column + 0.5) / columns) * (bounds.east - bounds.west);
      points.push({ lat, lng, cellSizeMeters });
    }
  }
  return points;
}

export function lngLatToTilePixel(
  point: Coordinate,
  zoom: number,
): TilePixelCoordinate {
  const scale = 2 ** zoom;
  const worldX = ((point.lng + 180) / 360) * 256 * scale;
  const sine = Math.sin((point.lat * Math.PI) / 180);
  const worldY =
    (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * 256 * scale;
  const tileX = Math.floor(worldX / 256);
  const tileY = Math.floor(worldY / 256);
  return {
    tileX,
    tileY,
    pixelX: Math.max(0, Math.min(255, Math.floor(worldX - tileX * 256))),
    pixelY: Math.max(0, Math.min(255, Math.floor(worldY - tileY * 256))),
  };
}

/** 同じタイルに入る避難場所をまとめ、画像取得を重複させない。 */
export function groupShelterTileRequests(
  targets: readonly ShelterTileTarget[],
  tileTemplate: string,
  zoom: number,
): ShelterTileRequest[] {
  const grouped = new Map<string, ShelterTileRequest>();
  for (const target of targets) {
    const tile = lngLatToTilePixel(target, zoom);
    const url = fillTileTemplate(tileTemplate, zoom, tile.tileX, tile.tileY);
    const request = grouped.get(url) ?? { url, targets: [] };
    request.targets.push({
      shelterId: target.shelterId,
      pixelX: tile.pixelX,
      pixelY: tile.pixelY,
    });
    grouped.set(url, request);
  }
  return [...grouped.values()];
}

export function classifyDepthColor(
  rgb: readonly [number, number, number],
  tolerance = 54,
): DepthClass | null {
  let result: DepthClass | null = null;
  let shortest = Number.POSITIVE_INFINITY;
  for (const depthClass of OFFICIAL_DEPTH_CLASSES) {
    const distance = Math.sqrt(
      (rgb[0] - depthClass.rgb[0]) ** 2 +
        (rgb[1] - depthClass.rgb[1]) ** 2 +
        (rgb[2] - depthClass.rgb[2]) ** 2,
    );
    if (distance < shortest) {
      shortest = distance;
      result = depthClass;
    }
  }
  return shortest <= tolerance ? result : null;
}

export function isInsideRegion(point: Coordinate): boolean {
  return (
    point.lng >= REGION_BOUNDS.west &&
    point.lng <= REGION_BOUNDS.east &&
    point.lat >= REGION_BOUNDS.south &&
    point.lat <= REGION_BOUNDS.north
  );
}

/** Ray castingによる地点包含判定。座標は [経度, 緯度]。 */
export function pointInRing(point: Coordinate, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point.lat !== yj > point.lat;
    if (crosses) {
      const longitude = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lng < longitude) inside = !inside;
    }
  }
  return inside;
}

export function coveragePercent(coveredPoints: number, sampledPoints: number): number | null {
  if (sampledPoints <= 0) return null;
  return Math.round((Math.max(0, coveredPoints) / sampledPoints) * 1000) / 10;
}

/** 画像取得とは独立した、地点水深区分と分析範囲の浸水割合の集計。 */
export function summarizeFloodSamples(
  pointPixel: Rgba | null,
  sampledPixels: readonly Rgba[],
): FloodSampleSummary {
  const classify = (pixel: Rgba | null) =>
    pixel && pixel[3] >= 24
      ? classifyDepthColor([pixel[0], pixel[1], pixel[2]])
      : null;
  const coveredPoints = sampledPixels.reduce(
    (total, pixel) => total + (classify(pixel) ? 1 : 0),
    0,
  );
  return {
    pointDepthClass: classify(pointPixel),
    coveredPoints,
    sampledPoints: sampledPixels.length,
    coveragePercent: coveragePercent(coveredPoints, sampledPixels.length),
  };
}

/**
 * 公式タイムステップの地点ピクセルだけから避難場所の浸水開始を要約する。
 * null は取得失敗であり、透明ピクセルや「浸水なし」と同一視しない。
 */
export function summarizeShelterFloodTiming(
  shelterId: string,
  samples: readonly ShelterFloodSample[],
  expectedSteps: number,
): ShelterFloodTiming {
  const ordered = [...samples].sort((a, b) => a.minutes - b.minutes);
  const readable = ordered.filter((sample) => sample.pixel !== null);
  const failedSteps = ordered.length - readable.length;
  const firstFlooded = readable.find((sample) => {
    const pixel = sample.pixel;
    return Boolean(
      pixel &&
      pixel[3] >= 24 &&
      classifyDepthColor([pixel[0], pixel[1], pixel[2]]),
    );
  });
  const depthClass = firstFlooded?.pixel
    ? classifyDepthColor([
        firstFlooded.pixel[0],
        firstFlooded.pixel[1],
        firstFlooded.pixel[2],
      ])
    : null;

  if (!readable.length) {
    return {
      shelterId,
      status: "unavailable",
      firstFloodedMinutes: null,
      depthClass: null,
      checkedSteps: 0,
      failedSteps,
    };
  }

  const incomplete = failedSteps > 0 || (!firstFlooded && ordered.length < expectedSteps);
  return {
    shelterId,
    status: incomplete ? "partial" : firstFlooded ? "flooded" : "not-flooded",
    firstFloodedMinutes: firstFlooded?.minutes ?? null,
    depthClass,
    checkedSteps: readable.length,
    failedSteps,
  };
}

export type ShelterMarkerState =
  | "loading"
  | "unavailable"
  | "partial"
  | "flood-detected"
  | "before-detected";

/**
 * 選択中の公式タイムステップ(currentMinutes)時点でのマーカー状態を導く。
 * 公式タイムステップ間は補間しない。summarizeShelterFloodTiming が確定した
 * status / firstFloodedMinutes だけを根拠にする。
 */
export function getShelterMarkerState(
  timing: ShelterFloodTiming | undefined,
  currentMinutes: number,
): ShelterMarkerState {
  if (!timing || timing.status === "loading") return "loading";
  if (timing.status === "unavailable") return "unavailable";
  if (timing.status === "partial") return "partial";
  if (timing.firstFloodedMinutes !== null && currentMinutes >= timing.firstFloodedMinutes) {
    return "flood-detected";
  }
  return "before-detected";
}

export function resolveShelterMarkerState(
  mode: "frequency" | "time",
  timing: ShelterFloodTiming | undefined,
  currentMinutes: number,
): ShelterMarkerState | "neutral" {
  return mode === "time" ? getShelterMarkerState(timing, currentMinutes) : "neutral";
}

// Keep these values aligned with app/globals.css :root shelter marker colors.
export const SHELTER_MARKER_STATE_COLORS: Record<ShelterMarkerState | "neutral", string> = {
  loading: "#151515",
  unavailable: "#777777",
  partial: "#ef7d35",
  "flood-detected": "#e44630",
  "before-detected": "#fffdf7",
  neutral: "#151515",
};

export function summarizeHydrograph(
  points: readonly HydrographPoint[],
  supplied?: Partial<HydrographSummary>,
): HydrographSummary {
  if (!points.length) {
    return {
      startMinutes: supplied?.startMinutes ?? null,
      maxDepthMeters: supplied?.maxDepthMeters ?? null,
      maxDepthAtMinutes: supplied?.maxDepthAtMinutes ?? null,
      durationMinutes: supplied?.durationMinutes ?? null,
    };
  }

  const positive = points.filter((point) => point.depthMeters > 0.01);
  const maximum = points.reduce((best, point) =>
    point.depthMeters > best.depthMeters ? point : best,
  );
  const computedStart = positive.length ? positive[0].hours * 60 : null;
  const computedDuration = positive.length
    ? (positive[positive.length - 1].hours - positive[0].hours) * 60
    : null;

  return {
    startMinutes: supplied?.startMinutes ?? computedStart,
    maxDepthMeters: supplied?.maxDepthMeters ?? maximum.depthMeters,
    maxDepthAtMinutes: supplied?.maxDepthAtMinutes ?? maximum.hours * 60,
    durationMinutes: supplied?.durationMinutes ?? computedDuration,
  };
}

export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const radius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(b.lat - a.lat);
  const longitudeDelta = toRadians(b.lng - a.lng);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/** 選択地点から別地点までの方角と直線距離を、地図外案内用に返す。 */
export function describeCoordinateDirection(
  origin: Coordinate,
  destination: Coordinate,
): CoordinateDirection {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const toDegrees = (radians: number) => (radians * 180) / Math.PI;
  const originLat = toRadians(origin.lat);
  const destinationLat = toRadians(destination.lat);
  const longitudeDelta = toRadians(destination.lng - origin.lng);
  const y = Math.sin(longitudeDelta) * Math.cos(destinationLat);
  const x = Math.cos(originLat) * Math.sin(destinationLat) -
    Math.sin(originLat) * Math.cos(destinationLat) * Math.cos(longitudeDelta);
  const bearing = (toDegrees(Math.atan2(y, x)) + 360) % 360;
  const directions = [
    { arrow: "↑", compassLabel: "北" },
    { arrow: "↗", compassLabel: "北東" },
    { arrow: "→", compassLabel: "東" },
    { arrow: "↘", compassLabel: "南東" },
    { arrow: "↓", compassLabel: "南" },
    { arrow: "↙", compassLabel: "南西" },
    { arrow: "←", compassLabel: "西" },
    { arrow: "↖", compassLabel: "北西" },
  ] as const;
  const direction = directions[Math.round(bearing / 45) % directions.length];
  const distanceMeters = Math.round(haversineMeters(origin, destination));
  const distanceLabel = distanceMeters < 1_000
    ? `約${distanceMeters}m`
    : `約${(distanceMeters / 1_000).toFixed(1)}km`;
  return { ...direction, distanceMeters, distanceLabel };
}

export function nearestFloodShelters(
  point: Coordinate,
  shelters: readonly FloodShelter[],
  limit = 3,
): FloodShelterDistance[] {
  return shelters
    .filter((shelter) => shelter.supportsFlood)
    .map((shelter) => ({
      ...shelter,
      distanceMeters: Math.round(haversineMeters(point, shelter)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, Math.max(0, limit));
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "確認できません";
  if (minutes < 60) return `${Math.round(minutes)}分`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}時間${rest}分` : `${hours}時間`;
}

export function heightComparison(depthMeters: number | null): string {
  if (depthMeters === null) return "深さの情報を確認できません";
  if (depthMeters <= 0.5) return "大人のひざほど";
  if (depthMeters <= 1) return "大人の腰〜胸ほど";
  if (depthMeters <= 3) return "1階の天井に届くほど";
  if (depthMeters <= 5) return "2階の床を越えるほど";
  if (depthMeters <= 10) return "3階以上に達する可能性";
  return "中高層階にも達する可能性";
}
