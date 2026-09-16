"use client";

import { useEffect, useRef, useState } from "react";
import {
  absoluteWaterHeight,
  boundsAroundPoint,
  buildRegionalGrid,
  classifyDepthColor,
  describeBreakPointCase,
  describeCoordinateDirection,
  fillTileTemplate,
  lngLatToTilePixel,
  representativeDepthMeters,
  resolveShelterMarkerState,
  SHELTER_MARKER_STATE_COLORS,
  type Flood3DMode,
  type FloodShelterDistance,
  type BreakPointScenario,
  type RegionBounds,
  type ShelterFloodTiming,
  type TerrainStatus,
  type ViewScope,
} from "../lib/risk";
import { BreakPointDetailCard } from "./BreakPointDetailCard";
import ShelterDetailCard from "./ShelterDetailCard";

type CesiumModule = Record<string, any>;
type ViewerStatus = "loading" | "ready" | "error";
type BuildingStatus = "loading" | "ready" | "error";
type GridStatus = "idle" | "loading" | "ready" | "empty" | "error";

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
    Cesium?: CesiumModule;
  }
}

const CESIUM_BASE_URL = "https://cdn.jsdelivr.net/npm/cesium@1.141.0/Build/Cesium/";
const PLATEAU_TERRAIN_URL = "https://tile.plateauview.mlit.go.jp/terrain";
const PLATEAU_BUILDINGS_URL =
  "https://assets.cms.plateau.reearth.io/assets/17/6b90ce-370e-4787-9c83-4c7905d0d82a/13119_itabashi-ku_pref_2025_citygml_1_op_bldg_3dtiles_13119_itabashi-ku_lod2/tileset.json";
const GRID_ZOOM = 15;
const TILE_SIZE = 256;

let cesiumPromise: Promise<CesiumModule> | null = null;
const gridTileCache = new Map<string, Promise<Uint8ClampedArray | null>>();

function loadCesium(): Promise<CesiumModule> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (cesiumPromise) return cesiumPromise;

  cesiumPromise = new Promise((resolve, reject) => {
    window.CESIUM_BASE_URL = CESIUM_BASE_URL;
    if (!document.querySelector('link[data-cesium="true"]')) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = `${CESIUM_BASE_URL}Widgets/widgets.css`;
      stylesheet.dataset.cesium = "true";
      document.head.appendChild(stylesheet);
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-cesium="true"]');
    if (existing) {
      existing.addEventListener("load", () =>
        window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium not found")),
      );
      existing.addEventListener("error", () => reject(new Error("Cesium failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = `${CESIUM_BASE_URL}Cesium.js`;
    script.async = true;
    script.dataset.cesium = "true";
    script.onload = () =>
      window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium not found"));
    script.onerror = () => reject(new Error("Cesium failed to load"));
    document.head.appendChild(script);
  });

  return cesiumPromise;
}

function loadGridTilePixels(url: string): Promise<Uint8ClampedArray | null> {
  const cached = gridTileCache.get(url);
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
  gridTileCache.set(url, promise);
  return promise;
}

function createSafeImageryProvider(
  Cesium: CesiumModule,
  overlayTemplate: string,
  regionBounds: RegionBounds,
  sourceName: string,
) {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: overlayTemplate,
    rectangle: Cesium.Rectangle.fromDegrees(
      regionBounds.west,
      regionBounds.south,
      regionBounds.east,
      regionBounds.north,
    ),
    credit: sourceName,
  });
  const requestImage = provider.requestImage.bind(provider);
  const transparentCanvas = document.createElement("canvas");
  transparentCanvas.width = 1;
  transparentCanvas.height = 1;
  provider.requestImage = (x: number, y: number, level: number, request: unknown) => {
    const result = requestImage(x, y, level, request);
    if (!result || typeof result.then !== "function") return result;
    return Promise.resolve(result).catch(() => transparentCanvas);
  };
  return provider;
}

export default function CesiumFloodView({
  lat,
  lng,
  depthMeters,
  depthLabel,
  scenarioLabel,
  sourceName,
  overlayTemplate,
  viewScope,
  flood3DMode,
  regionBounds,
  nearestShelters,
  shelterFloodTimings,
  currentMinutes,
  mode,
  showShelters,
  shelterDataStatus,
  selectedBreakpoint,
  selectedShelterId,
  onMarkerSelect,
  onViewInList,
}: {
  lat: number;
  lng: number;
  depthMeters: number | null;
  depthLabel: string;
  scenarioLabel: string;
  sourceName: string;
  overlayTemplate: string | null;
  viewScope: ViewScope;
  flood3DMode: Flood3DMode;
  regionBounds: RegionBounds;
  nearestShelters: FloodShelterDistance[];
  shelterFloodTimings: Record<string, ShelterFloodTiming>;
  currentMinutes: number;
  mode: "frequency" | "time";
  showShelters: boolean;
  shelterDataStatus: "loading" | "ready" | "error";
  selectedBreakpoint: BreakPointScenario | null | undefined;
  selectedShelterId: string | null;
  onMarkerSelect: (shelterId: string) => void;
  onViewInList: (shelterId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const terrainProviderRef = useRef<any>(null);
  const tilesetRef = useRef<any>(null);
  const floodLayerRef = useRef<any>(null);
  const gridPrimitiveRef = useRef<any>(null);
  const gaugeDataSourceRef = useRef<any>(null);
  const shelterDataSourceRef = useRef<any>(null);
  const breakPointDataSourceRef = useRef<any>(null);
  const conceptDataSourceRef = useRef<any>(null);
  const gridRequestRef = useRef(0);
  const groundHeightCacheRef = useRef(new Map<string, number>());
  const shelterButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const shelterCardRef = useRef<HTMLElement | null>(null);
  const breakPointButtonRef = useRef<HTMLButtonElement | null>(null);
  const breakPointCardRef = useRef<HTMLElement | null>(null);
  const breakPointInViewRef = useRef(false);
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>("loading");
  const [buildingStatus, setBuildingStatus] = useState<BuildingStatus>("loading");
  const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>("loading");
  const [gridStatus, setGridStatus] = useState<GridStatus>("idle");
  const [gridCellCount, setGridCellCount] = useState(0);
  const [groundHeight, setGroundHeight] = useState(0);
  const [shelterGroundHeights, setShelterGroundHeights] = useState<Record<string, number>>({});
  const [breakPointGroundHeight, setBreakPointGroundHeight] = useState(0);
  const [breakPointOpen, setBreakPointOpen] = useState(false);
  const [breakPointFocus, setBreakPointFocus] = useState(false);
  const [breakPointInView, setBreakPointInView] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then(async (Cesium) => {
        if (cancelled || !containerRef.current) return;
        let terrainProvider: any;
        try {
          terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
            PLATEAU_TERRAIN_URL,
            { requestVertexNormals: true },
          );
          if (!cancelled) setTerrainStatus("ready");
        } catch {
          terrainProvider = new Cesium.EllipsoidTerrainProvider();
          if (!cancelled) setTerrainStatus("fallback");
        }
        if (cancelled || !containerRef.current) return;

        terrainProviderRef.current = terrainProvider;
        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          selectionIndicator: false,
          infoBox: false,
          terrainProvider,
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.UrlTemplateImageryProvider({
              url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
              credit: "地理院タイル",
              maximumLevel: 18,
            }),
          ),
        });
        viewerRef.current = viewer;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50;
        viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25_000;
        viewer.scene.fog.enabled = true;

        const gaugeDataSource = new Cesium.CustomDataSource("gauge");
        const shelterDataSource = new Cesium.CustomDataSource("shelters");
        const breakPointDataSource = new Cesium.CustomDataSource("breakpoint");
        const conceptDataSource = new Cesium.CustomDataSource("breakpoint-concept");
        await viewer.dataSources.add(gaugeDataSource);
        await viewer.dataSources.add(shelterDataSource);
        await viewer.dataSources.add(breakPointDataSource);
        await viewer.dataSources.add(conceptDataSource);
        if (cancelled || viewer.isDestroyed()) return;
        gaugeDataSourceRef.current = gaugeDataSource;
        shelterDataSourceRef.current = shelterDataSource;
        breakPointDataSourceRef.current = breakPointDataSource;
        conceptDataSourceRef.current = conceptDataSource;
        setViewerStatus("ready");

        try {
          const tileset = await Cesium.Cesium3DTileset.fromUrl(PLATEAU_BUILDINGS_URL);
          if (cancelled || viewer.isDestroyed()) return;
          tileset.maximumScreenSpaceError = 8;
          tileset.dynamicScreenSpaceError = true;
          tilesetRef.current = tileset;
          viewer.scene.primitives.add(tileset);
          setBuildingStatus("ready");
        } catch {
          if (!cancelled) setBuildingStatus("error");
        }
      })
      .catch(() => !cancelled && setViewerStatus("error"));

    return () => {
      cancelled = true;
      gridRequestRef.current += 1;
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      terrainProviderRef.current = null;
      tilesetRef.current = null;
      floodLayerRef.current = null;
      gridPrimitiveRef.current = null;
      gaugeDataSourceRef.current = null;
      shelterDataSourceRef.current = null;
      breakPointDataSourceRef.current = null;
      conceptDataSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (tilesetRef.current) {
      tilesetRef.current.maximumScreenSpaceError = viewScope === "district" ? 12 : 5;
    }
  }, [viewScope]);

  useEffect(() => {
    setBreakPointOpen(false);
    setBreakPointFocus(false);
  }, [mode, selectedBreakpoint?.BPName]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (!viewer || !Cesium || viewerStatus !== "ready") return;
    viewer.camera.cancelFlight();
    if (breakPointFocus && mode === "time" && selectedBreakpoint) {
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(
            selectedBreakpoint.BPLon,
            selectedBreakpoint.BPLat,
            breakPointGroundHeight,
          ),
          90,
        ),
        {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(25),
            Cesium.Math.toRadians(-24),
            360,
          ),
          duration: 0.75,
        },
      );
    } else if (viewScope === "district") {
      const corners = [
        Cesium.Cartesian3.fromDegrees(regionBounds.west, regionBounds.south, 0),
        Cesium.Cartesian3.fromDegrees(regionBounds.east, regionBounds.south, 0),
        Cesium.Cartesian3.fromDegrees(regionBounds.east, regionBounds.north, 0),
        Cesium.Cartesian3.fromDegrees(regionBounds.west, regionBounds.north, 0),
      ];
      const sphere = Cesium.BoundingSphere.fromPoints(corners);
      viewer.camera.flyToBoundingSphere(sphere, {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(18),
          Cesium.Math.toRadians(-48),
          Math.max(8_000, sphere.radius * 2.4),
        ),
        duration: 0.8,
      });
    } else {
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lng, lat, 0), 800),
        {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(18),
            Cesium.Math.toRadians(-32),
            1_700,
          ),
          duration: 0.7,
        },
      );
    }
  }, [
    breakPointFocus,
    breakPointGroundHeight,
    lat,
    lng,
    mode,
    regionBounds,
    selectedBreakpoint,
    viewScope,
    viewerStatus,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (!viewer || !Cesium || viewerStatus !== "ready") return;
    if (floodLayerRef.current) {
      viewer.imageryLayers.remove(floodLayerRef.current, true);
      floodLayerRef.current = null;
    }
    if (!overlayTemplate) {
      viewer.scene.requestRender();
      return;
    }
    try {
      const provider = createSafeImageryProvider(Cesium, overlayTemplate, regionBounds, sourceName);
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = flood3DMode === "depth-grid" ? 0.3 : 0.72;
      floodLayerRef.current = layer;
      viewer.scene.requestRender();
    } catch {
      floodLayerRef.current = null;
    }
  }, [overlayTemplate, regionBounds, sourceName, viewerStatus]);

  useEffect(() => {
    if (floodLayerRef.current) {
      floodLayerRef.current.alpha = flood3DMode === "depth-grid" ? 0.3 : 0.72;
      viewerRef.current?.scene.requestRender();
    }
  }, [flood3DMode]);

  useEffect(() => {
    let cancelled = false;
    const Cesium = window.Cesium;
    const terrainProvider = terrainProviderRef.current;
    if (!Cesium || !terrainProvider || viewerStatus !== "ready") return;
    if (terrainStatus !== "ready") {
      setGroundHeight(0);
      return;
    }
    const point = Cesium.Cartographic.fromDegrees(lng, lat);
    Cesium.sampleTerrainMostDetailed(terrainProvider, [point])
      .then((sampled: any[]) => {
        if (!cancelled) setGroundHeight(Number.isFinite(sampled[0]?.height) ? sampled[0].height : 0);
      })
      .catch(() => !cancelled && setGroundHeight(0));
    return () => {
      cancelled = true;
    };
  }, [lat, lng, terrainStatus, viewerStatus]);

  useEffect(() => {
    let cancelled = false;
    const Cesium = window.Cesium;
    const terrainProvider = terrainProviderRef.current;
    if (mode !== "time" || !selectedBreakpoint) {
      setBreakPointGroundHeight(0);
      return;
    }
    if (!Cesium || !terrainProvider || viewerStatus !== "ready" || terrainStatus !== "ready") {
      setBreakPointGroundHeight(0);
      return;
    }
    const key = `${selectedBreakpoint.BPLat.toFixed(6)},${selectedBreakpoint.BPLon.toFixed(6)}`;
    const cached = groundHeightCacheRef.current.get(key);
    if (cached !== undefined) {
      setBreakPointGroundHeight(cached);
      return;
    }
    const point = Cesium.Cartographic.fromDegrees(
      selectedBreakpoint.BPLon,
      selectedBreakpoint.BPLat,
    );
    Cesium.sampleTerrainMostDetailed(terrainProvider, [point])
      .then((sampled: any[]) => {
        const height = Number.isFinite(sampled[0]?.height) ? sampled[0].height : 0;
        groundHeightCacheRef.current.set(key, height);
        if (!cancelled) setBreakPointGroundHeight(height);
      })
      .catch(() => {
        groundHeightCacheRef.current.set(key, 0);
        if (!cancelled) setBreakPointGroundHeight(0);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedBreakpoint, terrainStatus, viewerStatus]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    const gaugeDataSource = gaugeDataSourceRef.current;
    if (!viewer || !Cesium || !gaugeDataSource || viewerStatus !== "ready") return;
    gaugeDataSource.entities.removeAll();
    const hasWater = depthMeters !== null && depthMeters > 0.01;
    const depth = Math.max(depthMeters ?? 0, 0);
    const markerLength = hasWater ? Math.max(depth, 0.5) : 1;
    const waterHeight = absoluteWaterHeight(groundHeight, depthMeters);

    gaugeDataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        lng,
        lat,
        groundHeight + markerLength / 2,
      ),
      cylinder: {
        length: markerLength,
        topRadius: 6,
        bottomRadius: 6,
        material: hasWater
          ? Cesium.Color.fromCssColorString("#075d91").withAlpha(0.9)
          : Cesium.Color.fromCssColorString("#444444").withAlpha(0.75),
        outline: true,
        outlineColor: Cesium.Color.WHITE,
      },
      label: {
        text: depthMeters === null ? "水深を確認できません" : depthLabel,
        font: "700 17px sans-serif",
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#111111").withAlpha(0.86),
        pixelOffset: new Cesium.Cartesian2(0, -42),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    if (hasWater && waterHeight !== null) {
      gaugeDataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, waterHeight),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString("#b8efff"),
          outlineColor: Cesium.Color.fromCssColorString("#075d91"),
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    viewer.scene.requestRender();
  }, [depthLabel, depthMeters, groundHeight, lat, lng, viewerStatus]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    const breakPointDataSource = breakPointDataSourceRef.current;
    const conceptDataSource = conceptDataSourceRef.current;
    if (
      !viewer ||
      !Cesium ||
      !breakPointDataSource ||
      !conceptDataSource ||
      viewerStatus !== "ready"
    ) return;

    breakPointDataSource.entities.removeAll();
    conceptDataSource.entities.removeAll();
    if (mode !== "time" || !selectedBreakpoint) {
      viewer.scene.requestRender();
      return;
    }

    const position = Cesium.Cartesian3.fromDegrees(
      selectedBreakpoint.BPLon,
      selectedBreakpoint.BPLat,
      breakPointGroundHeight + 9,
    );
    breakPointDataSource.entities.add({
      id: `breakpoint:${selectedBreakpoint.BPName}`,
      position,
      cylinder: {
        length: 18,
        topRadius: 5,
        bottomRadius: 5,
        material: Cesium.Color.fromCssColorString("#f2a900").withAlpha(0.94),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#151515"),
      },
    });

    if (breakPointFocus) {
      const leveeCenter = Cesium.Cartesian3.fromDegrees(
        selectedBreakpoint.BPLon,
        selectedBreakpoint.BPLat,
        breakPointGroundHeight + 3,
      );
      conceptDataSource.entities.add({
        position: leveeCenter,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          leveeCenter,
          new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(90), 0, 0),
        ),
        box: {
          dimensions: new Cesium.Cartesian3(110, 14, 6),
          material: Cesium.Color.fromCssColorString("#8a6f4d").withAlpha(0.66),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#5b452f").withAlpha(0.9),
        },
      });
      const latitudeStep = 0.000035;
      const longitudeStep = 0.00004;
      conceptDataSource.entities.add({
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(
              selectedBreakpoint.BPLon - longitudeStep,
              selectedBreakpoint.BPLat + latitudeStep,
              breakPointGroundHeight + 6.2,
            ),
            Cesium.Cartesian3.fromDegrees(
              selectedBreakpoint.BPLon,
              selectedBreakpoint.BPLat,
              breakPointGroundHeight + 6.4,
            ),
            Cesium.Cartesian3.fromDegrees(
              selectedBreakpoint.BPLon + longitudeStep,
              selectedBreakpoint.BPLat - latitudeStep,
              breakPointGroundHeight + 6.2,
            ),
          ],
          width: 7,
          material: Cesium.Color.fromCssColorString("#2f241b").withAlpha(0.95),
          arcType: Cesium.ArcType.NONE,
        },
      });
    }
    viewer.scene.requestRender();
  }, [breakPointFocus, breakPointGroundHeight, mode, selectedBreakpoint, viewerStatus]);

  useEffect(() => {
    let cancelled = false;
    const Cesium = window.Cesium;
    const terrainProvider = terrainProviderRef.current;

    if (!nearestShelters.length) {
      setShelterGroundHeights({});
      return;
    }
    if (!Cesium || !terrainProvider || viewerStatus !== "ready" || terrainStatus !== "ready") {
      setShelterGroundHeights(Object.fromEntries(
        nearestShelters.map((shelter) => [shelter.id, 0]),
      ));
      return;
    }

    const keyFor = (shelter: FloodShelterDistance) =>
      `${shelter.lat.toFixed(6)},${shelter.lng.toFixed(6)}`;
    const uncached = nearestShelters.filter(
      (shelter) => !groundHeightCacheRef.current.has(keyFor(shelter)),
    );

    const commitHeights = () => {
      if (cancelled) return;
      setShelterGroundHeights(Object.fromEntries(
        nearestShelters.map((shelter) => [
          shelter.id,
          groundHeightCacheRef.current.get(keyFor(shelter)) ?? 0,
        ]),
      ));
    };

    if (!uncached.length) {
      commitHeights();
      return;
    }

    const cartographics = uncached.map((shelter) =>
      Cesium.Cartographic.fromDegrees(shelter.lng, shelter.lat),
    );
    Cesium.sampleTerrainMostDetailed(terrainProvider, cartographics)
      .then((sampled: any[]) => {
        sampled.forEach((sample, index) => {
          groundHeightCacheRef.current.set(
            keyFor(uncached[index]),
            Number.isFinite(sample?.height) ? sample.height : 0,
          );
        });
        commitHeights();
      })
      .catch(() => {
        uncached.forEach((shelter) => groundHeightCacheRef.current.set(keyFor(shelter), 0));
        commitHeights();
      });

    return () => {
      cancelled = true;
    };
  }, [nearestShelters, terrainStatus, viewerStatus]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    const shelterDataSource = shelterDataSourceRef.current;
    if (!viewer || !Cesium || !shelterDataSource || viewerStatus !== "ready") return;

    shelterDataSource.entities.removeAll();
    if (!showShelters) {
      viewer.scene.requestRender();
      return;
    }

    nearestShelters.forEach((shelter, index) => {
      const state = resolveShelterMarkerState(
        mode,
        shelterFloodTimings[shelter.id],
        currentMinutes,
      );
      const color = Cesium.Color.fromCssColorString(SHELTER_MARKER_STATE_COLORS[state]);
      const darkText = state === "before-detected" || state === "partial";
      const ground = shelterGroundHeights[shelter.id] ?? 0;
      const selected = shelter.id === selectedShelterId;
      shelterDataSource.entities.add({
        id: `shelter:${shelter.id}`,
        position: Cesium.Cartesian3.fromDegrees(shelter.lng, shelter.lat, ground + 6),
        cylinder: {
          length: 12,
          topRadius: selected ? 5.5 : 4.5,
          bottomRadius: selected ? 5.5 : 4.5,
          material: color.withAlpha(0.92),
          outline: true,
          outlineColor: selected ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString("#151515"),
        },
        label: {
          text: `0${index + 1}`,
          font: "800 15px sans-serif",
          fillColor: darkText ? Cesium.Color.fromCssColorString("#151515") : Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: color.withAlpha(0.94),
          backgroundPadding: new Cesium.Cartesian2(8, 6),
          pixelOffset: new Cesium.Cartesian2(0, -28),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(500, 1, 12_000, 0.72),
        },
      });
    });
    viewer.scene.requestRender();
  }, [
    currentMinutes,
    mode,
    nearestShelters,
    selectedShelterId,
    shelterFloodTimings,
    shelterGroundHeights,
    showShelters,
    viewerStatus,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (!viewer || !Cesium || viewerStatus !== "ready") return;
    const scene = viewer.scene;
    const scratchDirection = new Cesium.Cartesian3();

    const positionElement = (
      shelter: FloodShelterDistance,
      element: HTMLElement | null,
      isCard: boolean,
    ) => {
      if (!element || !showShelters) {
        if (element) element.style.display = "none";
        return;
      }
      const position = Cesium.Cartesian3.fromDegrees(
        shelter.lng,
        shelter.lat,
        (shelterGroundHeights[shelter.id] ?? 0) + 12,
      );
      const direction = Cesium.Cartesian3.subtract(position, viewer.camera.positionWC, scratchDirection);
      const inFront = Cesium.Cartesian3.dot(direction, viewer.camera.directionWC) > 0;
      const screen = inFront
        ? Cesium.SceneTransforms.worldToWindowCoordinates(scene, position)
        : undefined;
      const margin = 90;
      const visible = Boolean(
        screen &&
        screen.x >= -margin &&
        screen.x <= scene.canvas.clientWidth + margin &&
        screen.y >= -margin &&
        screen.y <= scene.canvas.clientHeight + margin,
      );
      if (!visible || !screen) {
        element.style.display = "none";
        return;
      }

      element.style.display = "";
      const markerY = screen.y - 28;
      if (isCard) {
        if (window.matchMedia("(max-width: 620px)").matches) {
          element.style.left = "";
          element.style.top = "";
          element.style.transform = "";
          return;
        }
        const below = markerY < 230;
        element.style.left = `${Math.max(170, Math.min(scene.canvas.clientWidth - 170, screen.x))}px`;
        element.style.top = `${below ? markerY + 34 : markerY - 34}px`;
        element.style.transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
        return;
      }

      const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, position);
      const scale = distance > 7_000 ? 0.72 : distance > 2_500 ? 0.84 : 1;
      element.style.left = `${screen.x}px`;
      element.style.top = `${markerY}px`;
      element.style.transform = `translate(-50%, -50%) scale(${scale})`;
    };

    const positionBreakPointElement = (
      element: HTMLElement | null,
      isCard: boolean,
    ) => {
      if (!element || mode !== "time" || !selectedBreakpoint) {
        if (element) element.style.display = "none";
        return false;
      }
      const position = Cesium.Cartesian3.fromDegrees(
        selectedBreakpoint.BPLon,
        selectedBreakpoint.BPLat,
        breakPointGroundHeight + 18,
      );
      const direction = Cesium.Cartesian3.subtract(
        position,
        viewer.camera.positionWC,
        scratchDirection,
      );
      const inFront = Cesium.Cartesian3.dot(direction, viewer.camera.directionWC) > 0;
      const screen = inFront
        ? Cesium.SceneTransforms.worldToWindowCoordinates(scene, position)
        : undefined;
      const margin = 42;
      const visible = Boolean(
        screen &&
        screen.x >= margin &&
        screen.x <= scene.canvas.clientWidth - margin &&
        screen.y >= margin &&
        screen.y <= scene.canvas.clientHeight - margin,
      );
      if (!visible || !screen) {
        element.style.display = "none";
        return false;
      }

      element.style.display = "";
      const markerY = screen.y - 38;
      if (isCard) {
        if (window.matchMedia("(max-width: 620px)").matches) {
          element.style.left = "";
          element.style.top = "";
          element.style.transform = "";
          return true;
        }
        const below = markerY < 230;
        element.style.left = `${Math.max(170, Math.min(scene.canvas.clientWidth - 170, screen.x))}px`;
        element.style.top = `${below ? markerY + 42 : markerY - 42}px`;
        element.style.transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
        return true;
      }

      element.style.left = `${screen.x}px`;
      element.style.top = `${markerY}px`;
      element.style.transform = "translate(-50%, -50%)";
      return true;
    };

    const updatePositions = () => {
      nearestShelters.forEach((shelter) => {
        positionElement(shelter, shelterButtonRefs.current[shelter.id], false);
      });
      const selected = nearestShelters.find((shelter) => shelter.id === selectedShelterId);
      if (selected) positionElement(selected, shelterCardRef.current, true);
      else if (shelterCardRef.current) shelterCardRef.current.style.display = "none";
      const visible = positionBreakPointElement(breakPointButtonRef.current, false);
      if (breakPointOpen) positionBreakPointElement(breakPointCardRef.current, true);
      else if (breakPointCardRef.current) breakPointCardRef.current.style.display = "none";
      if (visible !== breakPointInViewRef.current) {
        breakPointInViewRef.current = visible;
        setBreakPointInView(visible);
      }
    };

    const removeListener = scene.postRender.addEventListener(updatePositions);
    updatePositions();
    return () => {
      removeListener();
    };
  }, [
    breakPointGroundHeight,
    breakPointOpen,
    mode,
    nearestShelters,
    selectedBreakpoint,
    selectedShelterId,
    shelterGroundHeights,
    showShelters,
    viewerStatus,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    const requestId = gridRequestRef.current + 1;
    gridRequestRef.current = requestId;

    const removeGrid = () => {
      if (viewer && gridPrimitiveRef.current && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(gridPrimitiveRef.current);
      }
      gridPrimitiveRef.current = null;
      setGridCellCount(0);
    };

    if (
      !viewer ||
      !Cesium ||
      viewerStatus !== "ready" ||
      flood3DMode !== "depth-grid" ||
      !overlayTemplate
    ) {
      removeGrid();
      setGridStatus("idle");
      return;
    }

    const cesium = Cesium;

    let cancelled = false;
    setGridStatus("loading");
    const mobile = window.matchMedia("(max-width: 620px)").matches;
    const selectedBounds = viewScope === "district"
      ? regionBounds
      : boundsAroundPoint({ lat, lng }, 800);
    const grid = buildRegionalGrid(selectedBounds, mobile ? 100 : 50, mobile ? 4_000 : 10_000);

    async function buildGrid() {
      const groups = new Map<
        string,
        Array<{ point: (typeof grid)[number]; pixelX: number; pixelY: number }>
      >();
      for (const point of grid) {
        const tile = lngLatToTilePixel(point, GRID_ZOOM);
        const url = fillTileTemplate(overlayTemplate!, GRID_ZOOM, tile.tileX, tile.tileY);
        const items = groups.get(url) ?? [];
        items.push({ point, pixelX: tile.pixelX, pixelY: tile.pixelY });
        groups.set(url, items);
      }

      const flooded: Array<{
        point: (typeof grid)[number];
        depthMeters: number;
        color: readonly [number, number, number];
      }> = [];
      const entries = [...groups.entries()];
      for (let index = 0; index < entries.length; index += 4) {
        const batch = entries.slice(index, index + 4);
        const results = await Promise.all(
          batch.map(async ([url, items]) => ({ items, pixels: await loadGridTilePixels(url) })),
        );
        if (cancelled || gridRequestRef.current !== requestId) return;
        for (const { items, pixels } of results) {
          if (!pixels) continue;
          for (const item of items) {
            const pixelIndex = (item.pixelY * TILE_SIZE + item.pixelX) * 4;
            if (pixels[pixelIndex + 3] < 24) continue;
            const depthClass = classifyDepthColor([
              pixels[pixelIndex],
              pixels[pixelIndex + 1],
              pixels[pixelIndex + 2],
            ]);
            if (!depthClass) continue;
            flooded.push({
              point: item.point,
              depthMeters: representativeDepthMeters(depthClass),
              color: depthClass.rgb,
            });
          }
        }
      }

      if (cancelled || gridRequestRef.current !== requestId) return;
      if (!flooded.length) {
        removeGrid();
        setGridStatus("empty");
        return;
      }

      const uncached = flooded.filter(({ point }) => {
        const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
        return !groundHeightCacheRef.current.has(key);
      });
      if (terrainStatus === "ready" && uncached.length) {
        for (let index = 0; index < uncached.length; index += 500) {
          const chunk = uncached.slice(index, index + 500);
          const cartographics = chunk.map(({ point }) =>
            cesium.Cartographic.fromDegrees(point.lng, point.lat),
          );
          try {
            const sampled = await cesium.sampleTerrainMostDetailed(
              terrainProviderRef.current,
              cartographics,
            );
            sampled.forEach((sample: any, sampleIndex: number) => {
              const point = chunk[sampleIndex].point;
              const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
              groundHeightCacheRef.current.set(
                key,
                Number.isFinite(sample?.height) ? sample.height : 0,
              );
            });
          } catch {
            chunk.forEach(({ point }) => {
              const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
              groundHeightCacheRef.current.set(key, 0);
            });
          }
          if (cancelled || gridRequestRef.current !== requestId) return;
        }
      }

      const instances = flooded.map(({ point, depthMeters: cellDepth, color }) => {
        const halfLatitude = point.cellSizeMeters / 2 / 111_320;
        const halfLongitude =
          point.cellSizeMeters /
          2 /
          (111_320 * Math.max(0.1, Math.cos((point.lat * Math.PI) / 180)));
        const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
        const cellGroundHeight = groundHeightCacheRef.current.get(key) ?? 0;
        return new cesium.GeometryInstance({
          geometry: new cesium.RectangleGeometry({
            rectangle: cesium.Rectangle.fromDegrees(
              Math.max(selectedBounds.west, point.lng - halfLongitude),
              Math.max(selectedBounds.south, point.lat - halfLatitude),
              Math.min(selectedBounds.east, point.lng + halfLongitude),
              Math.min(selectedBounds.north, point.lat + halfLatitude),
            ),
            height: cellGroundHeight,
            extrudedHeight: cellGroundHeight + cellDepth,
            vertexFormat: cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: cesium.ColorGeometryInstanceAttribute.fromColor(
              cesium.Color.fromBytes(color[0], color[1], color[2], 132),
            ),
          },
        });
      });

      if (cancelled || gridRequestRef.current !== requestId || viewer.isDestroyed()) return;
      const primitive = new cesium.Primitive({
        geometryInstances: instances,
        appearance: new cesium.PerInstanceColorAppearance({
          translucent: true,
          closed: true,
        }),
        asynchronous: true,
        allowPicking: false,
      });
      removeGrid();
      gridPrimitiveRef.current = viewer.scene.primitives.add(primitive);
      setGridCellCount(instances.length);
      setGridStatus("ready");
      viewer.scene.requestRender();
    }

    buildGrid().catch(() => {
      if (!cancelled && gridRequestRef.current === requestId) {
        removeGrid();
        setGridStatus("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    flood3DMode,
    lat,
    lng,
    overlayTemplate,
    regionBounds,
    terrainStatus,
    viewScope,
    viewerStatus,
  ]);

  const hasWater = depthMeters !== null && depthMeters > 0.01;
  const statusCopy = flood3DMode === "depth-grid"
    ? gridStatus === "loading"
      ? `${sourceName}から立体表示を作成中…`
      : gridStatus === "ready"
        ? `${gridCellCount.toLocaleString()}格子を表示`
        : gridStatus === "empty"
          ? "この時点の浸水格子を確認できません"
          : gridStatus === "error"
            ? "水深の立体表示を作成できません"
            : "水深の立体表示（概算）"
    : overlayTemplate
      ? `${sourceName}の浸水範囲を地形へ重ねています`
      : "この規模では地点の浸水範囲を表示できません";
  const selectedShelter = nearestShelters.find(
    (shelter) => shelter.id === selectedShelterId,
  );
  const breakPointDescription = selectedBreakpoint
    ? describeBreakPointCase(selectedBreakpoint)
    : null;
  const breakPointDirection = selectedBreakpoint
    ? describeCoordinateDirection(
        { lat, lng },
        { lat: selectedBreakpoint.BPLat, lng: selectedBreakpoint.BPLon },
      )
    : null;

  return (
    <div className="cesium-shell">
      <div
        ref={containerRef}
        className="cesium-view"
        role="img"
        aria-label={`PLATEAU建物、${sourceName}、選択地点の水位を比較する3D表示`}
      />
      {mode === "time" && selectedBreakpoint && (
        <div className="cesium-breakpoint-controls">
          <button
            type="button"
            onClick={() => {
              setBreakPointOpen(false);
              setBreakPointFocus((value) => !value);
            }}
          >
            {breakPointFocus ? "街全体を見る" : "破堤地点を拡大"}
          </button>
        </div>
      )}
      {mode === "time" && selectedBreakpoint && (
        <button
          ref={breakPointButtonRef}
          type="button"
          className={`map-breakpoint-marker cesium-breakpoint-marker${breakPointOpen ? " selected" : ""}`}
          style={{ display: "none" }}
          aria-label={`3Dの想定上の決壊地点、${breakPointDescription?.displayLabel || selectedBreakpoint.BPLocation}、詳細を${breakPointOpen ? "閉じる" : "開く"}`}
          aria-pressed={breakPointOpen}
          onClick={() => setBreakPointOpen((value) => !value)}
        >
          <span aria-hidden="true">▲</span>
          <small>想定上の決壊地点</small>
        </button>
      )}
      {mode === "time" && selectedBreakpoint && breakPointOpen && (
        <aside
          ref={breakPointCardRef}
          className="map-shelter-card map-breakpoint-card cesium-breakpoint-card"
          style={{ display: "none" }}
          aria-label="想定上の決壊地点の詳細"
        >
          <BreakPointDetailCard
            scenario={selectedBreakpoint}
            onClose={() => setBreakPointOpen(false)}
          />
        </aside>
      )}
      {mode === "time" && selectedBreakpoint && breakPointDirection && !breakPointInView && !breakPointFocus && (
        <div className="map-breakpoint-direction cesium-breakpoint-direction">
          <strong>
            {breakPointDirection.arrow} 決壊地点は{breakPointDirection.compassLabel}方向 {breakPointDirection.distanceLabel}
          </strong>
          <button type="button" onClick={() => setBreakPointFocus(true)}>決壊地点を見る</button>
        </div>
      )}
      {showShelters && nearestShelters.map((shelter, index) => {
        const state = resolveShelterMarkerState(
          mode,
          shelterFloodTimings[shelter.id],
          currentMinutes,
        );
        const selected = shelter.id === selectedShelterId;
        const distance = shelter.distanceMeters < 1000
          ? `${shelter.distanceMeters}m`
          : `${(shelter.distanceMeters / 1000).toFixed(1)}km`;
        return (
          <button
            key={shelter.id}
            ref={(element) => { shelterButtonRefs.current[shelter.id] = element; }}
            type="button"
            className={`map-shelter-marker cesium-shelter-marker ${state}${selected ? " selected" : ""}`}
            style={{ display: "none" }}
            aria-label={`3D避難場所 0${index + 1} ${shelter.name}、選択地点から直線${distance}、詳細を${selected ? "閉じる" : "開く"}`}
            aria-pressed={selected}
            onClick={() => onMarkerSelect(shelter.id)}
          >
            <span>0{index + 1}</span>
          </button>
        );
      })}
      {showShelters && selectedShelter && (() => {
        const rank = nearestShelters.findIndex((shelter) => shelter.id === selectedShelter.id) + 1;
        return (
          <aside
            ref={shelterCardRef}
            className="map-shelter-card cesium-shelter-card"
            style={{ display: "none" }}
            aria-label={`${selectedShelter.name}の詳細`}
          >
            <ShelterDetailCard
              shelter={selectedShelter}
              rank={rank}
              mode={mode}
              timing={shelterFloodTimings[selectedShelter.id]}
              origin={{ lat, lng }}
              onViewInList={onViewInList}
            />
          </aside>
        );
      })()}
      {showShelters && shelterDataStatus !== "loading" && !nearestShelters.length && (
        <div className="map-shelter-status">
          <strong>避難場所データを読み込めません。</strong>
          <span>国土地理院の指定緊急避難場所データを確認してください。</span>
        </div>
      )}
      {viewerStatus === "loading" && <div className="map-state">PLATEAU地形と3D建物を読み込み中…</div>}
      {viewerStatus === "error" && (
        <div className="map-state">3D表示を読み込めません。2D地図は利用できます。</div>
      )}
      <div className="cesium-readout" aria-live="polite">
        <span>{scenarioLabel}</span>
        <strong>{depthLabel}</strong>
        <small>{hasWater ? `選択地点の地面からの水深 ${depthMeters?.toFixed(1)}m` : "選択地点の水面は表示していません"}</small>
        <small>{statusCopy}</small>
      </div>
      {terrainStatus === "fallback" && (
        <div className="cesium-terrain-warning">PLATEAU地形を取得できないため、高さ比較は参考表示です</div>
      )}
      {buildingStatus === "error" && (
        <div className="cesium-building-warning">PLATEAU建物を取得できないため、地形と浸水だけを表示中</div>
      )}
      {flood3DMode === "depth-grid" && (gridStatus === "empty" || gridStatus === "error") && (
        <div className="cesium-grid-warning">
          {gridStatus === "empty"
            ? "この時点では、立体表示にできる浸水区分が見つかりませんでした。"
            : `立体表示を作成できないため、${sourceName}を重ねて表示しています。`}
        </div>
      )}
      {breakPointFocus && mode === "time" && selectedBreakpoint && (
        <div className="cesium-breakpoint-concept-note">
          この堤防と亀裂は、選択ケースの位置を理解するための概念表現です。実際の堤防形状、壊れ方、水の流れを再現するものではありません。
        </div>
      )}
      <div className="cesium-credit">PLATEAU｜Mapterhorn｜国土地理院</div>
      <p className="map-caption">
        {flood3DMode === "depth-grid"
          ? `${sourceName}の水深区分を高さのあるブロックに置き換えた比較表示です。連続した水面や水の流れを再現するものではありません。`
          : `色の付いた範囲は${sourceName}を地形へ重ねたものです。縦のゲージだけが選択地点の水深を表します。`}
        {showShelters && nearestShelters.length > 0
          ? " 避難場所の点は、国土地理院の避難場所データに登録された施設の代表地点です。色は国土地理院「浸水ナビ」の時点データの読み取り結果であり、施設・経路の安全性を示しません。"
          : ""}
      </p>
    </div>
  );
}
