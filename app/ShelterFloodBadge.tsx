"use client";

import { formatMinutes, type ShelterFloodTiming } from "../lib/risk";
import { SHINSUI_NAVI_SOURCE } from "../lib/source-labels";

export default function ShelterFloodBadge({ timing }: { timing: ShelterFloodTiming | undefined }) {
  if (!timing || timing.status === "loading") {
    return <div className="shelter-flood-badge loading"><strong>浸水開始時刻を確認中</strong></div>;
  }
  if (timing.status === "unavailable") {
    return (
      <div className="shelter-flood-badge unavailable">
        <strong>公式データを読み込めないため、浸水開始時刻を判定できません</strong>
        <small>この表示だけでは、浸水なしとは判断できません</small>
      </div>
    );
  }
  if (timing.status === "not-flooded") {
    return <div className="shelter-flood-badge not-flooded"><strong>確認できた時点では、浸水区分は見つかりませんでした</strong></div>;
  }
  if (timing.status === "partial") {
    const foundFlooding = timing.firstFloodedMinutes !== null;
    return (
      <div className="shelter-flood-badge partial">
        <strong>
          {foundFlooding
            ? `確認できた範囲では、遅くとも破堤後${formatMinutes(timing.firstFloodedMinutes)}までに浸水区分が現れます`
            : "一部の公式時点データを読み込めないため、浸水開始時刻を判定できません"}
        </strong>
        <small>{foundFlooding ? "一部の公式時点データを読み込めません" : "この表示だけでは、浸水なしとは判断できません"}</small>
      </div>
    );
  }
  return (
    <div className="shelter-flood-badge flooded">
      <strong>破堤後{formatMinutes(timing.firstFloodedMinutes)}から浸水区分を確認</strong>
      <small>{timing.depthClass ? `${SHINSUI_NAVI_SOURCE}で確認した水深区分 ${timing.depthClass.label}` : `${SHINSUI_NAVI_SOURCE}で浸水区分を確認`}</small>
    </div>
  );
}
