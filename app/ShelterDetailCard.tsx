"use client";

import type {
  Coordinate,
  FloodShelterDistance,
  ShelterFloodTiming,
} from "../lib/risk";
import ShelterFloodBadge from "./ShelterFloodBadge";

export default function ShelterDetailCard({
  shelter,
  rank,
  mode,
  timing,
  origin,
  onViewInList,
}: {
  shelter: FloodShelterDistance;
  rank: number;
  mode: "frequency" | "time";
  timing: ShelterFloodTiming | undefined;
  origin: Coordinate;
  onViewInList: (shelterId: string) => void;
}) {
  const distance = shelter.distanceMeters < 1000
    ? `${shelter.distanceMeters}m`
    : `${(shelter.distanceMeters / 1000).toFixed(1)}km`;

  return (
    <>
      <span className="map-shelter-rank">0{rank}</span>
      <div>
        <strong>{shelter.name}</strong>
        <small>{distance}（直線）</small>
      </div>
      {mode === "time"
        ? <ShelterFloodBadge timing={timing} />
        : <small className="map-shelter-frequency-note">周辺の浸水状況：現在選んでいる地図で確認してください</small>}
      <div className="map-shelter-card-actions">
        <button type="button" onClick={() => onViewInList(shelter.id)}>一覧で詳しく見る</button>
        <a
          href={`https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${shelter.lat},${shelter.lng}&travelmode=walking`}
          target="_blank"
          rel="noreferrer"
        >
          平常時の徒歩経路 ↗
        </a>
      </div>
    </>
  );
}
