/**
 * Schema, referential integrity, and rule checks for the archive.
 *
 * Run: npm run validate
 *
 * The editorial rules in CLAUDE.md are only real if a machine enforces them, so this
 * file is where each of the nine rules becomes a build failure. Where a check exists
 * because the supplied spec could not enforce something it asked for, that is noted at
 * the check. See DECISIONS.md.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Kind = "claim" | "entity" | "source" | "correction" | "coverage" | "tenure";

export type RuleCode =
  | "SCHEMA"
  | "REF_MISSING"
  | "VERIFIER_NOT_ALLOWLISTED"
  | "PREDICATE_UNKNOWN"
  | "VALUE_TYPE_MISMATCH"
  | "ENUM_CODE_UNKNOWN"
  | "ASSERTION_TYPE_MISMATCH"
  | "QUALIFIER_MISSING"
  | "APPLIES_TO_MISMATCH"
  | "TARGET_TYPE_MISMATCH"
  | "SUPERSEDE_CYCLE"
  | "MONEY_MAGNITUDE_MISMATCH"
  | "MONEY_AS_PRINTED_UNPARSEABLE"
  | "PROHIBITED_FIELD"
  | "PROHIBITED_VOCABULARY"
  | "PLACEHOLDER_DATA"
  | "COMMENT_IN_DATA"
  | "PATH_ID_MISMATCH"
  | "TIMELINE_INCOHERENT"
  | "TIMESTAMP_IN_FUTURE"
  | "STATUS_NOT_RENDERABLE"
  | "TENURE_OVERLAP";

export interface Finding {
  file: string;
  rule: RuleCode;
  severity: "error" | "warn";
  message: string;
}

export interface LoadedRecord {
  kind: Kind;
  path: string;
  data: Record<string, any>;
}

export interface Registries {
  predicates: Record<string, any>;
  verifiers: Set<string>;
  prohibited: Record<string, any>;
  policy: Record<string, any>;
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SCHEMA_FILE: Record<Kind, string> = {
  claim: "claim.schema.json",
  entity: "entity.schema.json",
  source: "source.schema.json",
  correction: "correction.schema.json",
  coverage: "coverage.schema.json",
  tenure: "tenure.schema.json",
};

let validators: Record<Kind, (d: unknown) => boolean> | null = null;

function getValidators() {
  if (validators) return validators;
  const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
  addFormats(ajv as any);
  const out: any = {};
  for (const [kind, file] of Object.entries(SCHEMA_FILE)) {
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas", file), "utf8"));
    out[kind] = ajv.compile(schema);
  }
  validators = out;
  return out as Record<Kind, (d: unknown) => boolean>;
}

// ---------------------------------------------------------------------------
// Paths <-> ids
//
// Ids contain colons, which NTFS cannot store in a filename. Paths drop the constant
// type prefix and let the directory carry it, so the id stays reconstructible.
// ---------------------------------------------------------------------------

export function idToPath(
  id: string,
  kind: Kind,
  opts: { year?: number; subjectType?: string; subjectSlug?: string } = {},
): string {
  const parts = id.split(":");
  switch (kind) {
    case "entity":
      return `data/entities/${parts[1]}/${parts[2]}.json`;
    case "source":
      return `data/sources/${opts.year}/${parts[1]}/${parts[2]}.json`;
    case "claim":
      return `data/claims/${opts.subjectType}/${opts.subjectSlug}/${parts[1]}.json`;
    case "correction":
      return `data/corrections/${parts[1]}.json`;
    case "coverage":
      return `data/coverage/${parts[1]}.json`;
    case "tenure":
      return `data/tenures/${parts[1]}.json`;
  }
}

export function pathToId(path: string, kind: Kind): string {
  const p = path.replace(/\\/g, "/").replace(/\.json$/, "").split("/");
  switch (kind) {
    case "entity":
      return `ent:${p[2]}:${p[3]}`;
    case "source":
      return `src:${p[3]}:${p[4]}`;
    case "claim":
      return `clm:${p[4]}`;
    case "correction":
      return `cor:${p[2]}`;
    case "coverage":
      return `ds:${p[2]}`;
    case "tenure":
      return `ten:${p[2]}`;
  }
}

// ---------------------------------------------------------------------------
// Money
//
// amount is stored in rupees, not paise — see DECISIONS.md #1. as_printed is the
// anchor that makes a 100x transcription slip visible instead of silent.
// ---------------------------------------------------------------------------

export function parseAsPrinted(raw: string): number | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[₹]/g, " ")
    .replace(/\brs\.?/g, " ")
    .replace(/\binr\b/g, " ")
    .replace(/\/-/g, " ")
    .trim();

  if (/^(nil|none|zero|nil\.)$/.test(s)) return 0;

  const m = s.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!m || m.index === undefined) return null;

  const n = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;

  const rest = s.slice(m.index + m[1]!.length);
  let mult = 1;
  if (/\b(cr|crore|crores)\b/.test(rest)) mult = 1e7;
  else if (/\b(lakh|lakhs|lac|lacs)\b/.test(rest)) mult = 1e5;
  else if (/\bthousand\b/.test(rest)) mult = 1e3;

  return Math.round(n * mult);
}

/** Printed figures are often rounded ("Rs. 4.2 Cr"), so allow 1% — far tighter than 100x. */
const MONEY_TOLERANCE = 0.01;

// ---------------------------------------------------------------------------
// Walking helpers
// ---------------------------------------------------------------------------

function* walk(node: any, path: string[] = []): Generator<{ key: string; value: any; path: string[] }> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walk(node[i], [...path, String(i)]);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    yield { key, value, path: [...path, key] };
    yield* walk(value, [...path, key]);
  }
}

/** Resolve a dotted path with [] for arrays, e.g. "coverage.gaps[].reason". */
function resolvePath(root: any, dotted: string): string[] {
  const segments = dotted.split(".");
  let current: any[] = [root];
  for (const raw of segments) {
    const isArray = raw.endsWith("[]");
    const key = isArray ? raw.slice(0, -2) : raw;
    const next: any[] = [];
    for (const node of current) {
      if (node === null || typeof node !== "object") continue;
      const v = node[key];
      if (v === undefined) continue;
      if (isArray && Array.isArray(v)) next.push(...v);
      else next.push(v);
    }
    current = next;
  }
  return current.filter((v): v is string => typeof v === "string");
}

const normaliseKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

export function validateArchive(records: LoadedRecord[], reg: Registries): Finding[] {
  const findings: Finding[] = [];
  const add = (r: LoadedRecord, rule: RuleCode, message: string, severity: "error" | "warn" = "error") =>
    findings.push({ file: r.path, rule, severity, message });

  const validate = getValidators();

  // Indexes for referential integrity.
  const entities = new Map<string, LoadedRecord>();
  const sources = new Map<string, LoadedRecord>();
  const claims = new Map<string, LoadedRecord>();
  const corrections = new Map<string, LoadedRecord>();
  for (const r of records) {
    const id = r.data.id;
    if (typeof id !== "string") continue;
    if (r.kind === "entity") entities.set(id, r);
    else if (r.kind === "source") sources.set(id, r);
    else if (r.kind === "claim") claims.set(id, r);
    else if (r.kind === "correction") corrections.set(id, r);
  }

  const prohibited = reg.prohibited;
  const fieldPatterns = new Set<string>(
    (prohibited.field_names?.patterns ?? []).map((p: string) => normaliseKey(p)),
  );
  const placeholder = prohibited.placeholder_data ?? {};
  const vocab = prohibited.vocabulary ?? {};

  for (const r of records) {
    // --- schema ---------------------------------------------------------
    const check = validate[r.kind] as any;
    if (!check(r.data)) {
      for (const err of check.errors ?? []) {
        add(r, "SCHEMA", `${err.instancePath || "/"} ${err.message}`);
      }
    }

    // --- $comment is for fixtures, never for published records ----------
    for (const { key } of walk(r.data)) {
      if (key === "$comment") {
        add(r, "COMMENT_IN_DATA", "$comment is permitted in tests/fixtures, not under /data");
        break;
      }
    }

    // --- rule 9: no personal data beyond public role --------------------
    // Exact match on the normalised key, never substring: "reason" contains "son",
    // and a substring rule would reject every coverage gap in the archive.
    for (const { key, path } of walk(r.data)) {
      if (fieldPatterns.has(normaliseKey(key))) {
        add(r, "PROHIBITED_FIELD", `prohibited field "${key}" at ${path.join(".")} — rule 9`);
      }
    }

    // --- placeholder data -----------------------------------------------
    const idStr = typeof r.data.id === "string" ? r.data.id : "";
    for (const bad of placeholder.id_substring_denylist ?? []) {
      if (idStr.includes(bad)) {
        add(r, "PLACEHOLDER_DATA", `id contains "${bad}" — sample records must never reach /data`);
      }
    }
    for (const { key, value } of walk(r.data)) {
      if (typeof value !== "string") continue;
      if (key === "sha256" && (placeholder.sha256_denylist ?? []).includes(value)) {
        add(r, "PLACEHOLDER_DATA", "placeholder sha256 — it matches the pattern but proves nothing");
      }
      if (/^https?:\/\//.test(value)) {
        let host = "";
        try {
          host = new URL(value).hostname;
        } catch {
          /* malformed URLs are the schema's problem */
        }
        for (const bad of placeholder.url_host_denylist ?? []) {
          if (host === bad || host.endsWith(`.${bad}`)) {
            add(r, "PLACEHOLDER_DATA", `placeholder host "${host}" in ${key}`);
          }
        }
      }
    }

    // --- rule 6: neutral vocabulary --------------------------------------
    // Scoped to generated and editorial strings. Verbatim source text is exempt: an
    // affidavit that says "accused" says "accused", and paraphrasing a source to dodge
    // a wordlist would be the worse failure.
    for (const dotted of vocab.checked_fields?.paths ?? []) {
      const [kindPrefix, ...rest] = dotted.split(".");
      if (kindPrefix !== r.kind) continue;
      for (const text of resolvePath(r.data, rest.join("."))) {
        for (const hit of vocabularyHits(text, vocab)) {
          add(r, "PROHIBITED_VOCABULARY", `"${hit}" in ${dotted} — rule 6`);
        }
      }
    }

    // --- path <-> id -----------------------------------------------------
    checkPath(r, entities, add);
  }

  // --- claim-specific rules ------------------------------------------------
  for (const r of records) {
    if (r.kind !== "claim") continue;
    const c = r.data;

    // referential integrity across every id-bearing field
    const refs: Array<[string, string | undefined, Map<string, LoadedRecord>]> = [
      ["subject", c.subject, entities],
      ["evidence.source_id", c.evidence?.source_id, sources],
      ["qualifiers.house", c.qualifiers?.house, entities],
      ["qualifiers.constituency", c.qualifiers?.constituency, entities],
      ["qualifiers.ministry", c.qualifiers?.ministry, entities],
      ["supersedes", c.supersedes, claims],
      ["superseded_by", c.superseded_by, claims],
      ["correction_id", c.correction_id, corrections],
    ];
    if (c.value?.type === "entity_ref") refs.push(["value.entity_id", c.value.entity_id, entities]);
    for (const [label, id, index] of refs) {
      if (id && !index.has(id)) add(r, "REF_MISSING", `${label} -> ${id} does not exist`);
    }
    for (const ce of c.corroborating_evidence ?? []) {
      if (!sources.has(ce.source_id)) {
        add(r, "REF_MISSING", `corroborating_evidence.source_id -> ${ce.source_id} does not exist`);
      }
    }
    for (const input of c.derivation?.inputs ?? []) {
      if (!claims.has(input)) add(r, "REF_MISSING", `derivation.inputs -> ${input} does not exist`);
    }

    // rule 3: only a human on the allowlist may verify
    for (const field of ["verified_by", "second_check_by"] as const) {
      const handle = c.verification?.[field];
      if (handle && !reg.verifiers.has(handle)) {
        add(
          r,
          "VERIFIER_NOT_ALLOWLISTED",
          `${field} "${handle}" is not in schemas/verifiers.json — rule 3`,
        );
      }
    }

    /*
     * Rule 2 plus the editorial policy: unverified figures render, except about a named
     * individual. A GDP series with unchecked years is useful and the label is honest;
     * a machine-extracted financial or criminal figure attached to a living person is
     * the one case where being wrong causes harm a label does not undo.
     *
     * Only fires for statuses that would actually reach a reader. draft and withdrawn
     * never render for anyone, so a person claim sitting in either is left alone.
     */
    const policy = reg.policy ?? {};
    const subjectForPolicy = entities.get(c.subject);
    if (subjectForPolicy) {
      const wouldRender: string[] = policy.renderable_status?.default ?? [];
      const allowed: string[] | undefined =
        policy.by_subject_type?.[subjectForPolicy.data.type]?.renderable_status;
      if (allowed && wouldRender.includes(c.status) && !allowed.includes(c.status)) {
        add(
          r,
          "STATUS_NOT_RENDERABLE",
          `status "${c.status}" would render, but schemas/policy.json permits only ` +
            `${allowed.join(", ")} for a ${subjectForPolicy.data.type} subject. ` +
            `Verify it, or change the policy deliberately.`,
        );
      }
    }

    // predicate-driven rules
    const p = reg.predicates[c.predicate];
    if (!p || c.predicate.startsWith("$")) {
      add(r, "PREDICATE_UNKNOWN", `"${c.predicate}" is absent from schemas/predicates.json`);
      continue;
    }

    if (c.value?.type && c.value.type !== p.value_type) {
      add(
        r,
        "VALUE_TYPE_MISMATCH",
        `value.type "${c.value.type}" but predicate declares "${p.value_type}"`,
      );
    }

    if (p.value_type === "enum" && c.value?.code && !(p.codes ?? []).includes(c.value.code)) {
      add(r, "ENUM_CODE_UNKNOWN", `code "${c.value.code}" is not declared for ${c.predicate}`);
    }

    if (p.assertion_type && c.assertion_type !== p.assertion_type) {
      add(
        r,
        "ASSERTION_TYPE_MISMATCH",
        `assertion_type "${c.assertion_type}" but predicate declares "${p.assertion_type}" — rule 5`,
      );
    }

    // This is what makes case_stage genuinely mandatory on declared_case.
    for (const q of p.requires_qualifiers ?? []) {
      if (c.qualifiers?.[q] === undefined) {
        add(r, "QUALIFIER_MISSING", `${c.predicate} requires qualifiers.${q}`);
      }
    }

    // This is what keeps audit_observation off person entities.
    const subject = entities.get(c.subject);
    if (subject && p.applies_to && !p.applies_to.includes(subject.data.type)) {
      add(
        r,
        "APPLIES_TO_MISMATCH",
        `${c.predicate} applies to ${p.applies_to.join(", ")} but subject is a ${subject.data.type}`,
      );
    }

    if (p.target_type && c.value?.type === "entity_ref") {
      const target = entities.get(c.value.entity_id);
      if (target && target.data.type !== p.target_type) {
        add(
          r,
          "TARGET_TYPE_MISMATCH",
          `${c.predicate} targets a ${p.target_type} but ${c.value.entity_id} is a ${target.data.type}`,
        );
      }
    }

    // Timeline coherence. A record cannot be verified before it was created, or
    // extracted after it. Caught nothing until the seed claims were generated with an
    // invented created_at twenty minutes in the future, and every other gate passed.
    const t = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
    const created = t(c.created_at);
    const order: Array<[string, number, string, number]> = [
      ["extraction.extracted_at", t(c.extraction?.extracted_at), "created_at", created],
      ["created_at", created, "verification.verified_at", t(c.verification?.verified_at)],
      ["created_at", created, "updated_at", t(c.updated_at)],
    ];
    for (const [earlierName, earlier, laterName, later] of order) {
      if (Number.isFinite(earlier) && Number.isFinite(later) && earlier > later) {
        add(
          r,
          "TIMELINE_INCOHERENT",
          `${earlierName} (${new Date(earlier).toISOString()}) is after ` +
            `${laterName} (${new Date(later).toISOString()})`,
        );
      }
    }
    const FUTURE_TOLERANCE_MS = 60 * 60 * 1000; // an hour, for clock skew between machines
    for (const [name, value] of [
      ["created_at", created],
      ["updated_at", t(c.updated_at)],
      ["extraction.extracted_at", t(c.extraction?.extracted_at)],
      ["verification.verified_at", t(c.verification?.verified_at)],
    ] as Array<[string, number]>) {
      if (Number.isFinite(value) && value > Date.now() + FUTURE_TOLERANCE_MS) {
        add(r, "TIMESTAMP_IN_FUTURE", `${name} is ${new Date(value).toISOString()}`, "warn");
      }
    }

    // money magnitude
    if (c.value?.type === "money" && typeof c.value.as_printed === "string") {
      const expected = parseAsPrinted(c.value.as_printed);
      if (expected === null) {
        add(
          r,
          "MONEY_AS_PRINTED_UNPARSEABLE",
          `cannot read a figure from as_printed "${c.value.as_printed}" — magnitude unchecked`,
          "warn",
        );
      } else {
        const drift = Math.abs(c.value.amount - expected) / Math.max(expected, 1);
        if (drift > MONEY_TOLERANCE) {
          add(
            r,
            "MONEY_MAGNITUDE_MISMATCH",
            `amount ${c.value.amount} but as_printed "${c.value.as_printed}" reads as ${expected}. ` +
              `amount is in rupees, not paise — see DECISIONS.md #1`,
          );
        }
      }
    }
  }

  // --- tenures -------------------------------------------------------------
  const tenures = records.filter((r) => r.kind === "tenure");
  for (const r of tenures) {
    const t = r.data;
    if (t.office && !entities.has(t.office)) {
      add(r, "REF_MISSING", `office -> ${t.office} does not exist`);
    }
    if (t.holder && !entities.has(t.holder)) {
      add(r, "REF_MISSING", `holder -> ${t.holder} does not exist`);
    }
    if (t.party_at_time && !entities.has(t.party_at_time)) {
      add(r, "REF_MISSING", `party_at_time -> ${t.party_at_time} does not exist`);
    }
    if (t.evidence?.source_id && !sources.has(t.evidence.source_id)) {
      add(r, "REF_MISSING", `evidence.source_id -> ${t.evidence.source_id} does not exist`);
    }
    for (const field of ["verified_by", "second_check_by"] as const) {
      const handle = t.verification?.[field];
      if (handle && !reg.verifiers.has(handle)) {
        add(r, "VERIFIER_NOT_ALLOWLISTED", `${field} "${handle}" is not in verifiers.json`);
      }
    }
    if (t.to && t.from && Date.parse(t.from) > Date.parse(t.to)) {
      add(r, "TIMELINE_INCOHERENT", `tenure runs from ${t.from} to ${t.to}`);
    }
  }

  /*
   * One office, one holder at a time. An overlap is normally a data error — two records
   * for the same span means one of them is wrong, and an indicator chart annotated with
   * both would show a period with two names against it. Genuine overlaps exist (an
   * acting appointment during a leave of absence), so both records may opt in.
   */
  for (let i = 0; i < tenures.length; i++) {
    for (let j = i + 1; j < tenures.length; j++) {
      const a = tenures[i]!, b = tenures[j]!;
      if (a.data.office !== b.data.office) continue;
      const aFrom = Date.parse(a.data.from);
      const bFrom = Date.parse(b.data.from);
      const aTo = a.data.to ? Date.parse(a.data.to) : Number.POSITIVE_INFINITY;
      const bTo = b.data.to ? Date.parse(b.data.to) : Number.POSITIVE_INFINITY;
      if (aFrom < bTo && bFrom < aTo) {
        if (a.data.overlaps_permitted && b.data.overlaps_permitted) continue;
        add(
          a,
          "TENURE_OVERLAP",
          `overlaps ${b.data.id} for ${a.data.office}. If genuine, set overlaps_permitted ` +
            `on both records and say why in the note.`,
        );
      }
    }
  }

  // --- rule 4: the version chain must terminate ---------------------------
  findings.push(...supersedeCycles(records, claims));

  return findings;
}

function vocabularyHits(text: string, vocab: any): string[] {
  const hits: string[] = [];
  for (const word of vocab.words ?? []) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) hits.push(word);
  }
  // "criminal" is banned only as an adjective for a person. Legal usage is correct and
  // unavoidable, so strip the allowed phrases first and see what is left.
  for (const [word, cfg] of Object.entries<any>(vocab.contextual ?? {})) {
    let stripped = text;
    for (const phrase of cfg.allowed_phrases ?? []) {
      stripped = stripped.replace(new RegExp(phrase, "gi"), " ");
    }
    if (new RegExp(`\\b${word}\\b`, "i").test(stripped)) hits.push(word);
  }
  return hits;
}

function supersedeCycles(records: LoadedRecord[], claims: Map<string, LoadedRecord>): Finding[] {
  const findings: Finding[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string, trail: string[]): void => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") {
      const rec = claims.get(id);
      findings.push({
        file: rec?.path ?? id,
        rule: "SUPERSEDE_CYCLE",
        severity: "error",
        message: `supersede chain loops: ${[...trail, id].join(" -> ")}`,
      });
      return;
    }
    state.set(id, "visiting");
    const next = claims.get(id)?.data.superseded_by;
    if (typeof next === "string" && claims.has(next)) visit(next, [...trail, id]);
    state.set(id, "done");
  };

  for (const r of records) {
    if (r.kind === "claim" && typeof r.data.id === "string") visit(r.data.id, []);
  }
  return findings;
}

function checkPath(
  r: LoadedRecord,
  entities: Map<string, LoadedRecord>,
  add: (r: LoadedRecord, rule: RuleCode, m: string) => void,
): void {
  const id = r.data.id;
  if (typeof id !== "string") return;
  let expected: string;
  if (r.kind === "source") {
    const dated = r.data.published_on ?? r.data.retrieved_at;
    const year = typeof dated === "string" ? Number(dated.slice(0, 4)) : NaN;
    if (!Number.isFinite(year)) return;
    expected = idToPath(id, "source", { year });
  } else if (r.kind === "claim") {
    const subject = entities.get(r.data.subject);
    if (!subject) return; // REF_MISSING already covers this
    expected = idToPath(id, "claim", {
      subjectType: subject.data.type,
      subjectSlug: String(subject.data.id).split(":")[2],
    });
  } else {
    expected = idToPath(id, r.kind);
  }
  const actual = r.path.replace(/\\/g, "/");
  if (actual !== expected) {
    add(r, "PATH_ID_MISMATCH", `id "${id}" belongs at ${expected}, found at ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// Loading from disk
// ---------------------------------------------------------------------------

const DIR_KIND: Record<string, Kind> = {
  claims: "claim",
  entities: "entity",
  sources: "source",
  corrections: "correction",
  coverage: "coverage",
  tenures: "tenure",
};

export function loadArchive(root = ROOT): LoadedRecord[] {
  const dataDir = join(root, "data");
  const out: LoadedRecord[] = [];
  const recurse = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) recurse(full);
      else if (name.endsWith(".json")) {
        const rel = relative(root, full).split(sep).join("/");
        const kind = DIR_KIND[rel.split("/")[1] ?? ""];
        if (!kind) continue;
        out.push({ kind, path: rel, data: JSON.parse(readFileSync(full, "utf8")) });
      }
    }
  };
  try {
    recurse(dataDir);
  } catch {
    /* an empty archive is valid — build order says the validator comes first */
  }
  return out;
}

export function loadRegistries(root = ROOT): Registries {
  const read = (f: string) => JSON.parse(readFileSync(join(root, "schemas", f), "utf8"));
  const verifiers = read("verifiers.json");
  return {
    predicates: read("predicates.json"),
    verifiers: new Set<string>(
      (verifiers.verifiers ?? [])
        .map((v: any) => v.handle)
        .filter((h: string) => !h.toLowerCase().includes("placeholder")),
    ),
    prohibited: read("prohibited.json"),
    policy: read("policy.json"),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const records = loadArchive();
  const findings = validateArchive(records, loadRegistries());
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);

  for (const [file, list] of [...byFile].sort()) {
    console.log(`\n${file}`);
    for (const f of list) {
      const mark = f.severity === "error" ? "FAIL" : "warn";
      console.log(`  ${mark}  ${f.rule}  ${f.message}`);
    }
  }

  const summary = `${records.length} records, ${errors.length} errors, ${warnings.length} warnings`;
  if (errors.length) {
    console.error(`\n${summary}`);
    process.exit(1);
  }
  console.log(`\n${summary}`);
}
