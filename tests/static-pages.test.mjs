import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const outputDirectory = path.resolve("out");
const basePath = "/machi-no-jakuten";
const workerApi =
  "https://machi-no-jakuten-shinsui-api.ritoyamasaki.workers.dev/api/shinsui";

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  }));
  return files.flat();
}

test("GitHub Pages artifact has a static entry point and public assets", async () => {
  await Promise.all([
    access(path.join(outputDirectory, "index.html")),
    access(path.join(outputDirectory, "favicon.png")),
    access(path.join(outputDirectory, "og-flood-v2.png")),
    access(path.join(outputDirectory, "data/itabashi-shelters.geojson")),
  ]);
});

test("HTML uses the repository base path for local scripts and styles", async () => {
  const html = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  const localAssetReferences = [
    ...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="(\/[^"]+)"/g),
  ].map((match) => match[1]);

  assert.ok(localAssetReferences.length > 0, "expected local JS/CSS references");
  for (const reference of localAssetReferences) {
    assert.ok(
      reference.startsWith(`${basePath}/`),
      `root-relative asset is missing the Pages base path: ${reference}`,
    );
  }
  assert.match(html, /href="\/machi-no-jakuten\/favicon\.png"/);
  assert.match(html, /https:\/\/0319-2004\.github\.io\/machi-no-jakuten\/og-flood-v2\.png/);
});

test("client bundle points to the Worker and base-prefixed shelter data", async () => {
  const files = await collectFiles(outputDirectory);
  const textFiles = files.filter((file) => /\.(?:html|js|css|json|txt|rsc)$/.test(file));
  const contents = (await Promise.all(textFiles.map((file) => readFile(file, "utf8")))).join("\n");

  assert.ok(contents.includes(workerApi), "preview Worker URL was not inlined");
  assert.ok(contents.includes(basePath), "Pages base path was not inlined");
  assert.ok(contents.includes("/data/itabashi-shelters.geojson"));
  assert.ok(!contents.includes('fetch("/api/shinsui'), "relative API fetch remains");
  assert.ok(!contents.includes('fetch("/data/'), "root-relative data fetch remains");
});

test("the deployable artifact is self-contained static content", async () => {
  const files = await collectFiles(outputDirectory);
  assert.ok(files.every((file) => !file.includes(`${path.sep}.next${path.sep}server${path.sep}`)));
  assert.ok(files.some((file) => file.endsWith("index.html")));
});
