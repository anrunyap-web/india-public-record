/**
 * Steps 2 and 3 of the pipeline: fetch, hash, archive.
 *
 *   npm run archive -- <url> --publisher <slug> --doc <slug> --doc-type <type>
 *
 * Downloads a document, computes its SHA-256, pushes it to the Internet Archive, and
 * writes a draft source record. It deliberately stops short of a complete record:
 * storage_url is filled in by upload-blob.ts, and nothing is marked usable as evidence
 * until both an archive_url and a storage_url exist.
 *
 * Needs IA_ACCESS_KEY and IA_SECRET_KEY in .env (gitignored). Get them from
 * https://archive.org/account/s3.php. The keys are read into memory and used only in
 * the Authorization header — never logged, never written to a record.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  // Strip a UTF-8 BOM: PowerShell's Out-File -Encoding utf8 writes one, which would
  // otherwise become part of the first variable's name.
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
  }
}

function credentials(): { access: string; secret: string } {
  loadEnv();
  const access = process.env.IA_ACCESS_KEY;
  const secret = process.env.IA_SECRET_KEY;
  if (!access || !secret) {
    console.error(
      "Missing IA_ACCESS_KEY / IA_SECRET_KEY.\n" +
        "Get them from https://archive.org/account/s3.php and put them in .env (gitignored).",
    );
    process.exit(1);
  }
  return { access, secret };
}

// ---------------------------------------------------------------------------
// Fetch and hash
// ---------------------------------------------------------------------------

const UA =
  "india-public-record/0.1 (+https://github.com/anrunyap-web/india-public-record) archival fetch";

export async function fetchAndHash(url: string, outPath: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(join(ROOT, "blobs"), { recursive: true });
  writeFileSync(outPath, bytes);

  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byte_size: bytes.byteLength,
    content_type: res.headers.get("content-type") ?? "",
    final_url: res.url,
    retrieved_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

// ---------------------------------------------------------------------------
// Internet Archive — Save Page Now v2
// ---------------------------------------------------------------------------

interface SpnResult {
  archive_url: string;
  timestamp: string;
}

export async function saveToInternetArchive(url: string): Promise<SpnResult> {
  const { access, secret } = credentials();
  const auth = { Authorization: `LOW ${access}:${secret}`, Accept: "application/json" };

  const submit = await fetch("https://web.archive.org/save", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ url, capture_all: "1", skip_first_archive: "1" }),
  });

  const submitted = (await submit.json()) as { job_id?: string; message?: string };
  if (!submitted.job_id) {
    throw new Error(`Save Page Now refused the capture: ${submitted.message ?? submit.status}`);
  }
  console.log(`  submitted to Internet Archive, job ${submitted.job_id}`);

  // SPN captures take anywhere from seconds to a couple of minutes on slow .gov.in hosts.
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`https://web.archive.org/save/status/${submitted.job_id}`, {
      headers: auth,
    });
    const st = (await poll.json()) as {
      status?: string;
      timestamp?: string;
      original_url?: string;
      message?: string;
    };
    if (st.status === "success" && st.timestamp) {
      return {
        archive_url: `https://web.archive.org/web/${st.timestamp}/${st.original_url ?? url}`,
        timestamp: st.timestamp,
      };
    }
    if (st.status === "error") throw new Error(`capture failed: ${st.message ?? "unknown"}`);
    process.stdout.write(".");
  }
  throw new Error("capture did not complete within five minutes");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const url = process.argv[2];
  const publisher = arg("publisher");
  const doc = arg("doc");
  const docType = arg("doc-type");

  if (!url || !publisher || !doc || !docType) {
    console.error(
      "usage: npm run archive -- <url> --publisher <slug> --doc <slug> --doc-type <type>",
    );
    process.exit(1);
  }

  const localPath = join(ROOT, "blobs", `${publisher}-${doc}.pdf`);

  console.log(`fetching ${url}`);
  const fetched = await fetchAndHash(url, localPath);
  console.log(`  ${fetched.byte_size} bytes, sha256 ${fetched.sha256.slice(0, 16)}…`);
  console.log(`  saved to blobs/${publisher}-${doc}.pdf (gitignored)`);

  console.log("archiving");
  const archived = await saveToInternetArchive(fetched.final_url);
  console.log(`\n  ${archived.archive_url}`);

  const record = {
    id: `src:${publisher}:${doc}`,
    title: "TODO — the document's own title, as printed",
    publisher: "TODO — the issuing body's full name",
    tier: 1,
    doc_type: docType,
    original_url: fetched.final_url,
    archive_url: archived.archive_url,
    storage_url: "TODO — run upload-blob.ts, then paste the release asset URL",
    sha256: fetched.sha256,
    byte_size: fetched.byte_size,
    retrieved_at: fetched.retrieved_at,
  };

  console.log("\nDraft source record — fill the TODOs, then place it at");
  console.log(`data/sources/<year>/${publisher}/${doc}.json\n`);
  console.log(JSON.stringify(record, null, 2));
  console.log(
    "\nThis is a draft, not evidence. validate.ts will reject it until storage_url is real.",
  );
}
