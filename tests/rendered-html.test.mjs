import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("高島平・舟渡水害編の主要画面をサーバー描画する", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html lang="ja">/i);
  assert.match(html, /高島平・舟渡 水害編/);
  assert.match(html, /頻度から見る/);
  assert.match(html, /時間から見る/);
  assert.match(html, /この画面で確認できること/);
  assert.match(html, /OFFICIAL SOURCE/);
  assert.match(html, /洪水時の指定緊急避難場所（最寄り3件）/);
  assert.match(html, /公式情報を確認する/);
  assert.match(html, /対象地域全体/);
  assert.match(html, /選択地点から800m/);
  assert.match(html, /class="active">選択地点から800m<\/button>/);
  assert.doesNotMatch(html, /注意順位/);
  assert.doesNotMatch(html, /A53に未収録|荒川GeoJSON/);
});

test("3Dの地図表示と立体表示の違いを操作時に案内する", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /浸水の見せ方を選ぶ/);
  assert.match(source, /公式地図を重ねる/);
  assert.match(source, /水深を立体で見る（概算）/);
  assert.match(source, /水深区分を高さのあるブロックで表します/);
  assert.match(source, /水の流れを再現するものではありません/);
  assert.match(source, /aria-describedby="flood-3d-mode-help"/);
});

test("診断の根拠をモード別に分け、決壊地点を2Dと3Dで案内する", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cesiumSource = await readFile(new URL("../app/CesiumFloodView.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /buildFrequencyHeadline/);
  assert.match(pageSource, /buildTimeHeadline/);
  assert.match(pageSource, /想定上の決壊地点/);
  assert.match(pageSource, /決壊地点を見る/);
  assert.match(pageSource, /選択地点へ戻る/);
  assert.doesNotMatch(pageSource, /全国順位や災害間ランキングではありません/);
  assert.match(cesiumSource, /破堤地点を拡大/);
  assert.match(cesiumSource, /街全体を見る/);
  assert.match(cesiumSource, /実際の堤防形状、壊れ方、水の流れを再現するものではありません/);
});

test("データ制約と免責を表示する", async () => {
  const response = await render();
  const html = await response.text();
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /この表示だけでは、浸水なしとは判断できません/);
  assert.match(html, /class="rain"/);
  assert.doesNotMatch(html, /降雨量を再現したものではありません/);
  assert.match(html, /安全な避難ルートとは判定していません/);
  assert.doesNotMatch(html, /浸水しません|安全です/);
  assert.match(html, /og-flood-v2\.png/);
});
