import type { FloodFrequencyScenario } from "./risk";

export const SHINSUI_NAVI_SOURCE = "国土地理院「浸水ナビ」";
export const HAZARD_PORTAL_SOURCE = "国土地理院「ハザードマップポータル」";
export const PLAN_SCALE_MAP_SOURCE = "荒川下流河川事務所「計画規模の浸水想定図」";

export function frequencyDocumentSourceName(
  scenario: FloodFrequencyScenario,
): string {
  return `国土交通省 関東地方整備局「国管理河川の浸水想定図（${scenario.label}規模降雨）」`;
}

export function frequencyMapSourceName(
  scenario: FloodFrequencyScenario,
): string {
  if (scenario.period === 200) return PLAN_SCALE_MAP_SOURCE;
  if (scenario.period === "maximum") return HAZARD_PORTAL_SOURCE;
  return frequencyDocumentSourceName(scenario);
}
