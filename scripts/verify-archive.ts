/**
 * Weekly link-rot check.
 *
 *   npm run verify-archive            report only, always exits 0
 *   npm run verify-archive -- --strict  exits 1 on any serious failure
 *
 * Three URLs per source, and they do not carry equal weight:
 *
 *   original_url   Expected to rot. A dead government URL is the reason this project
 *                  archives anything, so it is reported, not failed.
 *   archive_url    The durability guarantee. If this breaks, the claim's evidence is
 *                  gone and the claim should not be rendering.
 *   storage_url    The convenience copy. Serious, but recoverable by re-uploading.
 *
 * A live archive_url is not sufficient on its own. The Internet Archive will happily
 * capture a WAF block page and report the job a success — capturing the ECI affidavit
 * portal yields a snapshot whose origin status was 403. So this also checks that the
 * snapshot is the document rather than an error page.
 */

import { loadArchive } from "./validate.js";

const UA =
  "india-public-record/0.1 (+https://github.com/anrunyap-web/india-public-record) link check";

type Weight = "expected-to-rot" | "serious";

interface Result {
  source: string;
  field: string;
  url: string;
  weight: Weight;
  ok: boolean;
  detail: string;
}

async function head(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    // Some government hosts reject HEAD but answer GET, so ask for one byte instead.
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Range: "bytes=0-0" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return { ok: res.ok || res.status === 206, detail: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, detail: e?.cause?.code ?? e?.name ?? "fetch failed" };
  }
}

/**
 * A wayback URL of the form /web/<timestamp>/<original>. The timestamp API reports the
 * status the origin returned at capture time, which is how a 403 block page is caught.
 */
async function checkSnapshot(archiveUrl: string): Promise<{ ok: boolean; detail: string }> {
  const m = archiveUrl.match(/\/web\/(\d{14})(?:id_)?\/(.+)$/);
  if (!m) return head(archiveUrl);

  const [, timestamp, original] = m;
  try {
    const res = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(original!)}&timestamp=${timestamp}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    const j = (await res.json()) as any;
    const snap = j?.archived_snapshots?.closest;
    if (!snap?.available) return { ok: false, detail: "no snapshot available" };
    const status = String(snap.status ?? "");
    if (status !== "200") {
      return { ok: false, detail: `snapshot captured origin HTTP ${status} — an error page, not the document` };
    }
    return { ok: true, detail: "snapshot ok, origin was 200 at capture" };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? "availability check failed" };
  }
}

const strict = process.argv.includes("--strict");

const sources = loadArchive().filter((r) => r.kind === "source");
if (sources.length === 0) {
  console.log("no source records yet — nothing to verify");
  process.exit(0);
}

const results: Result[] = [];

for (const s of sources) {
  const id = s.data.id as string;

  for (const [field, weight] of [
    ["original_url", "expected-to-rot"],
    ["storage_url", "serious"],
  ] as Array<[string, Weight]>) {
    const url = s.data[field];
    if (typeof url !== "string") continue;
    const r = await head(url);
    results.push({ source: id, field, url, weight, ...r });
  }

  if (typeof s.data.archive_url === "string") {
    const r = await checkSnapshot(s.data.archive_url);
    results.push({
      source: id,
      field: "archive_url",
      url: s.data.archive_url,
      weight: "serious",
      ...r,
    });
  }
}

for (const r of results) {
  const mark = r.ok ? "ok  " : r.weight === "serious" ? "FAIL" : "rot ";
  console.log(`${mark}  ${r.source}  ${r.field}  ${r.detail}`);
  if (!r.ok) console.log(`        ${r.url}`);
}

const serious = results.filter((r) => !r.ok && r.weight === "serious");
const rotted = results.filter((r) => !r.ok && r.weight === "expected-to-rot");

console.log(
  `\n${sources.length} sources, ${results.length} checks, ` +
    `${serious.length} serious failures, ${rotted.length} original URLs rotted`,
);
if (rotted.length) {
  console.log("Rotted original URLs are expected and are why the archive copies exist.");
}
if (serious.length && strict) process.exit(1);
