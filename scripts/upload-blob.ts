/**
 * Uploads a fetched document to the blobs repo and prints its storage_url.
 *
 *   npm run upload-blob -- blobs/<file>.pdf --tag <release-tag>
 *
 * Source PDFs never live in this repository (CLAUDE.md, hosting constraints). They go
 * to anrunyap-web/india-public-record-blobs as release assets, which do not count
 * against repo size, allow up to 2 GB per file, and are not bandwidth-billed.
 *
 * The archive_url is the durability guarantee; this copy is only a convenience. If the
 * project later moves to R2 or B2, migrating is a rewrite of storage_url per record and
 * verify-archive.ts catches anything that breaks meanwhile.
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BLOBS_REPO = "anrunyap-web/india-public-record-blobs";

function ghPath(): string {
  const candidates = ["gh", "C:\\Program Files\\GitHub CLI\\gh.exe"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      /* try the next one */
    }
  }
  throw new Error("gh CLI not found. Install it, or add it to PATH.");
}

function gh(args: string[], opts: { allowFailure?: boolean } = {}): string {
  try {
    return execFileSync(ghPath(), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    if (opts.allowFailure) return "";
    throw new Error(`gh ${args.join(" ")} failed:\n${e.stderr ?? e.message}`);
  }
}

export function uploadBlob(filePath: string, tag: string): string {
  const abs = resolve(ROOT, filePath);
  if (!existsSync(abs)) throw new Error(`no such file: ${abs}`);
  const name = basename(abs);
  const size = statSync(abs).size;

  console.log(`uploading ${name} (${size.toLocaleString()} bytes) to ${BLOBS_REPO}`);

  const exists = gh(["release", "view", tag, "--repo", BLOBS_REPO], { allowFailure: true });
  if (!exists) {
    console.log(`  creating release ${tag}`);
    gh([
      "release", "create", tag,
      "--repo", BLOBS_REPO,
      "--title", tag,
      "--notes", "Archived source documents. Each asset is referenced by a source record's storage_url.",
    ]);
  }

  gh(["release", "upload", tag, abs, "--repo", BLOBS_REPO, "--clobber"]);

  const storageUrl = `https://github.com/${BLOBS_REPO}/releases/download/${tag}/${encodeURIComponent(name)}`;
  console.log(`  done\n\nstorage_url:\n${storageUrl}`);
  return storageUrl;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const file = process.argv[2];
  const tag = arg("tag");
  if (!file || !tag) {
    console.error("usage: npm run upload-blob -- <path-to-file> --tag <release-tag>");
    process.exit(1);
  }
  uploadBlob(file, tag);
}
