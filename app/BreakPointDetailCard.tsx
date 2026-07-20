"use client";

import {
  describeBreakPointCase,
  type BreakPointScenario,
} from "../lib/risk";

export function BreakPointDetailCard({
  scenario,
  onClose,
}: {
  scenario: BreakPointScenario;
  onClose: () => void;
}) {
  const description = describeBreakPointCase(scenario);

  return (
    <>
      <span className="map-breakpoint-symbol" aria-hidden="true">▲</span>
      <div>
        <strong>想定上の決壊地点</strong>
        <small>
          {description.riverName}
          {description.locationLabel ? `（${description.locationLabel}）` : ""}
        </small>
      </div>
      <p className="map-breakpoint-case">ケースID：{description.caseId}</p>
      <p className="map-breakpoint-explanation">
        この地点は、時系列シミュレーションの計算条件です。
      </p>
      <div className="map-breakpoint-card-actions">
        <button type="button" onClick={onClose}>閉じる</button>
      </div>
    </>
  );
}
