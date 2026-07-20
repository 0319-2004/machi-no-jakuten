import assert from "node:assert/strict";
import test from "node:test";
import {
  absoluteWaterHeight,
  boundsAroundPoint,
  buildFrequencyHeadline,
  buildRegionalGrid,
  buildShinsuiTileTemplate,
  buildTimeHeadline,
  classifyDepthColor,
  coveragePercent,
  describeBreakPointCase,
  describeCoordinateDirection,
  extendedRiverCode,
  fillTileTemplate,
  FREQUENCY_SCENARIOS,
  getShelterMarkerState,
  groupShelterTileRequests,
  isInsideRegion,
  lngLatToTilePixel,
  nearestFloodShelters,
  parseBreakPointLocation,
  pointInRing,
  representativeDepthMeters,
  resolveShelterMarkerState,
  shinsuiRainfallScale,
  summarizeFloodSamples,
  summarizeHydrograph,
  summarizeShelterFloodTiming,
  type FloodShelter,
  type BreakPointScenario,
} from "../lib/risk.ts";

const breakPointFixture: BreakPointScenario = {
  ID: "54",
  BPName: "BP054",
  BPLocation: "28.80km 右岸",
  BPLat: 35.8001,
  BPLon: 139.7001,
  EntryRiverName: "荒川",
  RiverCode: "8303040001",
  SubRiverCode: "_",
  CSVScale: 0,
  OfficeCode: "21280",
  BPTime: [0, 60, 120],
  isDepthMax: true,
  isStartMax: false,
  isDurationMax: false,
};

test("頻度シナリオを高頻度から想定最大の順に保つ", () => {
  assert.deepEqual(FREQUENCY_SCENARIOS.map((item) => item.period), [10, 30, 50, 100, 200, "maximum"]);
});

test("板橋区の関係市区町判定と公式原本を頻度ごとに保持する", () => {
  const byPeriod = new Map(FREQUENCY_SCENARIOS.map((item) => [item.period, item]));
  assert.equal(byPeriod.get(10)?.itabashiIncluded, false);
  assert.equal(byPeriod.get(30)?.itabashiIncluded, false);
  assert.equal(byPeriod.get(50)?.itabashiIncluded, true);
  assert.equal(byPeriod.get(100)?.itabashiIncluded, true);
  assert.equal(byPeriod.get(50)?.tileTemplate, null);
  assert.equal(byPeriod.get(100)?.tileTemplate, null);
  assert.match(byPeriod.get(10)?.sourceUrl ?? "", /000838175\.pdf$/);
  assert.match(byPeriod.get(100)?.sourceUrl ?? "", /000838179\.pdf$/);
  assert.equal(byPeriod.get(200)?.sourcePublishedAt, "2022-08-31");
});

test("地点分析は1/200と想定最大の公式タイルだけに限定する", () => {
  const analysable = FREQUENCY_SCENARIOS
    .filter((item) => item.tileTemplate)
    .map((item) => item.period);
  assert.deepEqual(analysable, [200, "maximum"]);
  assert.equal(FREQUENCY_SCENARIOS.find((item) => item.period === 200)?.rainfall72hMm, 516);
});

test("ArcGISのz/y/x順で公式1/200タイルURLを生成する", () => {
  const template = FREQUENCY_SCENARIOS.find((item) => item.period === 200)?.tileTemplate;
  assert.ok(template);
  assert.equal(
    fillTileTemplate(template, 15, 29096, 12891),
    "https://tiles-ap1.arcgis.com/PZQkxlojiiLRSa6b/arcgis/rest/services/Arakawa_keikakukibo/MapServer/tile/15/12891/29096",
  );
});

test("公式色を浸水深区分へ変換する", () => {
  assert.equal(classifyDepthColor([255, 183, 183])?.label, "3〜5m");
  assert.equal(classifyDepthColor([220, 122, 220])?.level, 7);
  assert.equal(classifyDepthColor([20, 40, 70]), null);
});

test("浸水ナビの時系列タイルURLを公式仕様どおり生成する", () => {
  const scenario = {
    BPName: "BP054",
    CSVScale: 0,
    OfficeCode: "21280",
    RiverCode: "8303040001",
    SubRiverCode: "_",
  };
  assert.equal(
    buildShinsuiTileTemplate(scenario, 720),
    "https://suiboumap.gsi.go.jp/shinsuimap/Tile/21280/L2/8303040001/BP054/BP054_00720m/{z}/{x}/{y}.png",
  );
  assert.equal(shinsuiRainfallScale(1), "L1");
  assert.equal(shinsuiRainfallScale(-1), "L1b");
  assert.equal(extendedRiverCode("8303040001", "2"), "83030400012");
});

test("破堤地点の距離標と岸を大文字小文字の違いを含めて解析する", () => {
  assert.deepEqual(parseBreakPointLocation("28.80km 右岸"), {
    bank: "right",
    distanceLabel: "28.80km",
    raw: "28.80km 右岸",
  });
  assert.deepEqual(parseBreakPointLocation("6.6Km 左岸"), {
    bank: "left",
    distanceLabel: "6.6km",
    raw: "6.6Km 左岸",
  });
  assert.deepEqual(parseBreakPointLocation("位置情報未確認"), {
    bank: null,
    distanceLabel: null,
    raw: "位置情報未確認",
  });
});

test("2Dと3Dで共有する破堤ケース説明を生成する", () => {
  const description = describeBreakPointCase(breakPointFixture);
  assert.equal(description.displayLabel, "荒川 右岸 28.80km");
  assert.equal(description.locationLabel, "右岸 28.80km");
  assert.equal(description.caseId, "BP054");
});

test("頻度モードの診断は1/200参考表示の地点区分だけを説明する", () => {
  assert.deepEqual(buildFrequencyHeadline({
    insideRegion: true,
    status: "available",
    pointDepthLabel: "0.5〜3m",
    sourceName: "荒川水系浸水想定区域図（計画規模）",
  }), {
    headline: "この地点では、大規模な洪水で0.5〜3m浸水する想定です。",
    note: "荒川下流河川事務所「計画規模の浸水想定図」による参考表示です。",
  });
});

test("時間モードの診断は選択時刻の水深と破堤ケースを説明する", () => {
  const copy = buildTimeHeadline({
    insideRegion: true,
    breakpointStatus: "ready",
    hydroStatus: "ready",
    selectedBreakpoint: breakPointFixture,
    currentMinutes: 672,
    currentDepthMeters: 0.5,
    summary: {
      startMinutes: 543,
      maxDepthMeters: 4,
      maxDepthAtMinutes: 60,
      durationMinutes: 40_320,
    },
  });
  assert.equal(
    copy.headline,
    "この決壊ケースでは、現在選んでいる時刻（破堤後11時間12分）の水深は0.5mの想定です。",
  );
  assert.match(copy.note, /荒川 右岸 28\.80km/);
  assert.match(copy.note, /浸水開始：破堤後9時間3分/);
  assert.match(copy.note, /最大水深：4\.0m/);
});

test("決壊地点までの方角と直線距離を案内する", () => {
  const direction = describeCoordinateDirection(
    { lat: 35.78814, lng: 139.66147 },
    { lat: 35.8101, lng: 139.6801 },
  );
  assert.equal(direction.compassLabel, "北東");
  assert.equal(direction.arrow, "↗");
  assert.ok(direction.distanceMeters > 2_500);
  assert.match(direction.distanceLabel, /^約\d+\.\d+km$/);
});

test("同じタイルに入る複数避難場所を一つの取得へまとめる", () => {
  const requests = groupShelterTileRequests([
    { shelterId: "a", lat: 35.78814, lng: 139.66147 },
    { shelterId: "b", lat: 35.7882, lng: 139.6615 },
  ], "https://example.test/{z}/{x}/{y}.png", 15);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].targets.map((target) => target.shelterId), ["a", "b"]);
});

test("避難場所の最初の公式浸水ステップを返し、途中時刻を補間しない", () => {
  const timing = summarizeShelterFloodTiming("shelter", [
    { minutes: 0, pixel: [0, 0, 0, 0] },
    { minutes: 120, pixel: [255, 183, 183, 255] },
  ], 2);
  assert.equal(timing.status, "flooded");
  assert.equal(timing.firstFloodedMinutes, 120);
  assert.equal(timing.depthClass?.label, "3〜5m");
});

test("避難場所の透明ピクセルを表示期間内の非該当として扱う", () => {
  const timing = summarizeShelterFloodTiming("shelter", [
    { minutes: 0, pixel: [255, 183, 183, 0] },
    { minutes: 60, pixel: [0, 0, 0, 0] },
  ], 2);
  assert.equal(timing.status, "not-flooded");
  assert.equal(timing.firstFloodedMinutes, null);
});

test("避難場所の一部取得失敗を浸水なしに変換しない", () => {
  const timing = summarizeShelterFloodTiming("shelter", [
    { minutes: 0, pixel: null },
    { minutes: 60, pixel: [0, 0, 0, 0] },
  ], 2);
  assert.equal(timing.status, "partial");
  assert.equal(timing.failedSteps, 1);
});

test("避難場所の全ステップ取得失敗をunavailableにする", () => {
  const timing = summarizeShelterFloodTiming("shelter", [
    { minutes: 0, pixel: null },
    { minutes: 60, pixel: null },
  ], 2);
  assert.equal(timing.status, "unavailable");
  assert.equal(timing.checkedSteps, 0);
});

test("取得中の避難場所マーカーはloadingになる", () => {
  assert.equal(getShelterMarkerState(undefined, 30), "loading");
  assert.equal(getShelterMarkerState(
    { shelterId: "s", status: "loading", firstFloodedMinutes: null, depthClass: null, checkedSteps: 0, failedSteps: 0 },
    30,
  ), "loading");
});

test("確認不能な避難場所マーカーはunavailableになる", () => {
  const timing = summarizeShelterFloodTiming("s", [{ minutes: 0, pixel: null }], 1);
  assert.equal(getShelterMarkerState(timing, 0), "unavailable");
});

test("一部未確認の避難場所マーカーはpartialになる", () => {
  const timing = summarizeShelterFloodTiming("s", [
    { minutes: 0, pixel: null },
    { minutes: 60, pixel: [0, 0, 0, 0] },
  ], 2);
  assert.equal(getShelterMarkerState(timing, 60), "partial");
});

test("現在時刻が浸水確認時刻以降ならflood-detectedになる(境界値を含む)", () => {
  const timing = summarizeShelterFloodTiming("s", [{ minutes: 60, pixel: [255, 183, 183, 255] }], 1);
  assert.equal(getShelterMarkerState(timing, 60), "flood-detected");
  assert.equal(getShelterMarkerState(timing, 120), "flood-detected");
});

test("現在時刻が浸水確認時刻より前ならbefore-detectedになる", () => {
  const timing = summarizeShelterFloodTiming("s", [{ minutes: 60, pixel: [255, 183, 183, 255] }], 1);
  assert.equal(getShelterMarkerState(timing, 0), "before-detected");
});

test("浸水区分が未確認(not-flooded)の避難場所マーカーはbefore-detectedに収束する", () => {
  const timing = summarizeShelterFloodTiming("s", [{ minutes: 0, pixel: [0, 0, 0, 0] }], 1);
  assert.equal(timing.status, "not-flooded");
  assert.equal(getShelterMarkerState(timing, 999), "before-detected");
});

test("頻度モードの避難場所マーカーは公式時系列を創作せずneutralになる", () => {
  const timing = summarizeShelterFloodTiming("s", [{ minutes: 60, pixel: [255, 183, 183, 255] }], 1);
  assert.equal(resolveShelterMarkerState("frequency", timing, 120), "neutral");
});

test("時間モードの避難場所マーカーは既存の公式時系列判定をそのまま使う", () => {
  const timing = summarizeShelterFloodTiming("s", [{ minutes: 60, pixel: [255, 183, 183, 255] }], 1);
  assert.equal(resolveShelterMarkerState("time", timing, 0), "before-detected");
  assert.equal(resolveShelterMarkerState("time", timing, 60), "flood-detected");
});

test("水深区分の代表値と地盤からの水位を純粋関数で計算する", () => {
  const threeToFive = classifyDepthColor([255, 183, 183]);
  const overTwenty = classifyDepthColor([220, 122, 220]);
  assert.ok(threeToFive);
  assert.ok(overTwenty);
  assert.equal(representativeDepthMeters(threeToFive), 4);
  assert.equal(representativeDepthMeters(overTwenty), 20);
  assert.equal(absoluteWaterHeight(37.2, 4), 41.2);
  assert.equal(absoluteWaterHeight(37.2, null), null);
});

test("地域境界と上限から3D格子を生成する", () => {
  const local = boundsAroundPoint({ lat: 35.78814, lng: 139.66147 }, 800);
  const grid = buildRegionalGrid(local, 50, 1000);
  assert.ok(grid.length > 0);
  assert.ok(grid.length <= 1000);
  assert.ok(grid.every((point) => point.cellSizeMeters >= 50));
  assert.ok(grid.every((point) => point.lat >= local.south && point.lat <= local.north));
  const tile = lngLatToTilePixel({ lat: 35.78814, lng: 139.66147 }, 15);
  assert.deepEqual({ x: tile.tileX, y: tile.tileY }, { x: 29096, y: 12891 });
});

test("800m区域割合を標本数から算出する", () => {
  assert.equal(coveragePercent(31, 100), 31);
  assert.equal(coveragePercent(1, 3), 33.3);
  assert.equal(coveragePercent(0, 100), 0);
  assert.equal(coveragePercent(0, 0), null);
});

test("タイル画像の地点色と標本色を純粋関数で集計する", () => {
  const result = summarizeFloodSamples(
    [255, 183, 183, 255],
    [
      [255, 183, 183, 255],
      [0, 0, 0, 0],
      [20, 40, 70, 255],
    ],
  );
  assert.equal(result.pointDepthClass?.label, "3〜5m");
  assert.equal(result.coveredPoints, 1);
  assert.equal(result.sampledPoints, 3);
  assert.equal(result.coveragePercent, 33.3);
});

test("地点包含と対象地域判定を純粋関数で行う", () => {
  const ring: [number, number][] = [[139.65, 35.78], [139.67, 35.78], [139.67, 35.80], [139.65, 35.80], [139.65, 35.78]];
  assert.equal(pointInRing({ lng: 139.66, lat: 35.79 }, ring), true);
  assert.equal(pointInRing({ lng: 139.7, lat: 35.79 }, ring), false);
  assert.equal(isInsideRegion({ lng: 139.66147, lat: 35.78814 }), true);
  assert.equal(isInsideRegion({ lng: 139.81419, lat: 35.69677 }), false);
});

test("洪水対応だけを抽出して最寄り順に並べる", () => {
  const shelters: FloodShelter[] = [
    { id: "far", name: "遠い", address: "", lat: 35.80, lng: 139.68, supportsFlood: true },
    { id: "near", name: "近い", address: "", lat: 35.789, lng: 139.662, supportsFlood: true },
    { id: "other", name: "洪水非対応", address: "", lat: 35.7882, lng: 139.6615, supportsFlood: false },
  ];
  const result = nearestFloodShelters({ lat: 35.78814, lng: 139.66147 }, shelters, 3);
  assert.deepEqual(result.map((item) => item.id), ["near", "far"]);
});

test("水深系列から浸水開始・最大深度・継続を要約する", () => {
  const summary = summarizeHydrograph([
    { hours: 0, depthMeters: 0 },
    { hours: 1, depthMeters: 0.2 },
    { hours: 2, depthMeters: 1.4 },
    { hours: 5, depthMeters: 0.1 },
    { hours: 6, depthMeters: 0 },
  ]);
  assert.equal(summary.startMinutes, 60);
  assert.equal(summary.maxDepthMeters, 1.4);
  assert.equal(summary.maxDepthAtMinutes, 120);
  assert.equal(summary.durationMinutes, 240);
});
