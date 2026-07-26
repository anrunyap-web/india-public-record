import type { LoadedRecord, Registries } from "../scripts/validate.js";

/** 25 valid Crockford base32 chars; append one more for a well-formed ULID. */
const ULID_STEM = "01JZQ8K4M7NPRXW2VYTB3CDE";

export function ulid(suffix = "FG"): string {
  const id = ULID_STEM + suffix;
  if (id.length !== 26) throw new Error(`test ulid is ${id.length} chars, need 26`);
  return id;
}

export function source(over: Record<string, unknown> = {}) {
  return {
    kind: "source" as const,
    path: "data/sources/2024/eci/kolar-2024-form26.json",
    data: {
      id: "src:eci:kolar-2024-form26",
      title: "Affidavit filed under Form 26, Kolar, general election 2024",
      language: ["en"],
      publisher: "Election Commission of India",
      tier: 1,
      doc_type: "affidavit",
      published_on: "2024-04-12",
      original_url: "https://affidavit.eci.gov.in/kolar/2024/form26.pdf",
      archive_url:
        "https://web.archive.org/web/20260726000000/https://affidavit.eci.gov.in/kolar/2024/form26.pdf",
      storage_url:
        "https://github.com/example-user/india-public-record-blobs/releases/download/eci-2024/kolar-form26.pdf",
      sha256: "9f2c1b7e4a3d5068c1b9e2f7a4d3c6501b8e9f2a7c4d3b6e015a8f9c2d7b4e63",
      byte_size: 2418177,
      page_count: 34,
      retrieved_at: "2026-07-26T09:14:02Z",
      text_layer: "ocr",
      ...over,
    },
  };
}

export function entity(over: Record<string, unknown> = {}) {
  return {
    kind: "entity" as const,
    path: "data/entities/person/asha-ramesh.json",
    data: {
      id: "ent:person:asha-ramesh",
      type: "person",
      canonical_name: "Asha Ramesh",
      inclusion_reason: "contested_election",
      coverage: {
        from: "2024-04-01",
        note: "Affidavit data exists from the 2024 general election onward. An empty period means no record is held, not that nothing occurred.",
      },
      created_at: "2026-07-26T09:20:00Z",
      ...over,
    },
  };
}

export function constituency(over: Record<string, unknown> = {}) {
  return {
    kind: "entity" as const,
    path: "data/entities/constituency/kolar.json",
    data: {
      id: "ent:constituency:kolar",
      type: "constituency",
      canonical_name: "Kolar",
      inclusion_reason: "administrative_unit",
      coverage: { from: "2024-04-01", note: "Boundaries as at the 2024 general election." },
      created_at: "2026-07-26T09:20:00Z",
      ...over,
    },
  };
}

export function party(over: Record<string, unknown> = {}) {
  return {
    kind: "entity" as const,
    path: "data/entities/party/janata-front.json",
    data: {
      id: "ent:party:janata-front",
      type: "party",
      canonical_name: "Janata Front",
      inclusion_reason: "registered_political_party",
      coverage: { from: "2024-04-01", note: "Registration record only." },
      created_at: "2026-07-26T09:20:00Z",
      ...over,
    },
  };
}

/** A money claim that passes every check. Override one field per test. */
export function claim(over: Record<string, unknown> = {}) {
  const data = {
    id: `clm:${ulid()}`,
    subject: "ent:person:asha-ramesh",
    predicate: "declared_total_assets",
    value: { type: "money", amount: 42000000, currency: "INR", as_printed: "4,20,00,000" },
    qualifiers: { as_of: "2024-04-12" },
    assertion_type: "declared_by_subject",
    evidence: {
      source_id: "src:eci:kolar-2024-form26",
      page: 7,
      locator: "Part A, item 3, total of columns (i) and (ii)",
    },
    status: "verified",
    extraction: { method: "manual", extracted_at: "2026-07-26T09:31:00Z" },
    verification: { verified_by: "handle:reviewer-a", verified_at: "2026-07-26T11:02:00Z" },
    created_at: "2026-07-26T09:31:00Z",
    ...over,
  };
  return {
    kind: "claim" as const,
    path: `data/claims/person/asha-ramesh/${(data.id as string).slice(4)}.json`,
    data,
  };
}

/** Registries with a single real verifier, so the allowlist check has something to pass. */
export function registries(over: Partial<Registries> = {}): Registries {
  return {
    predicates: PREDICATES,
    verifiers: new Set(["handle:reviewer-a", "handle:reviewer-b"]),
    prohibited: PROHIBITED,
    ...over,
  } as Registries;
}

export function archive(...records: LoadedRecord[]): LoadedRecord[] {
  return records;
}

/** Minimal slice of predicates.json — enough to exercise every predicate-driven rule. */
const PREDICATES: Record<string, any> = {
  declared_total_assets: {
    label: "Total assets declared",
    value_type: "money",
    applies_to: ["person"],
    assertion_type: "declared_by_subject",
    requires_qualifiers: ["as_of"],
  },
  declared_case: {
    label: "Case declared in affidavit",
    value_type: "string",
    applies_to: ["person"],
    assertion_type: "declared_by_subject",
    requires_qualifiers: ["as_of", "case_stage"],
  },
  party_affiliation: {
    label: "Party affiliation",
    value_type: "entity_ref",
    target_type: "party",
    applies_to: ["person"],
    assertion_type: "recorded_by_authority",
  },
  election_outcome: {
    label: "Election outcome",
    value_type: "enum",
    codes: ["elected", "not_elected", "withdrawn", "disqualified", "result_countermanded"],
    applies_to: ["person"],
    assertion_type: "recorded_by_authority",
    requires_qualifiers: ["constituency", "as_of"],
  },
  audit_observation: {
    label: "Audit observation recorded",
    value_type: "string",
    applies_to: ["ministry", "scheme", "project", "body"],
    assertion_type: "recorded_by_authority",
    requires_qualifiers: ["financial_year"],
  },
  sitting_days: {
    label: "Days the house sat",
    value_type: "integer",
    applies_to: ["house"],
    assertion_type: "recorded_by_authority",
    requires_qualifiers: ["session"],
  },
};

const PROHIBITED: any = {
  field_names: {
    patterns: [
      "address", "phone", "email", "spouse", "spousename",
      "father", "fathername", "caste", "religion", "dob",
    ],
  },
  vocabulary: {
    words: ["corrupt", "tainted", "accused", "scandal", "failed", "successful"],
    contextual: {
      criminal: { allowed_phrases: ["criminal case", "criminal cases", "criminal proceedings"] },
    },
    checked_fields: {
      paths: [
        "entity.disambiguation",
        "entity.coverage.note",
        "entity.coverage.gaps[].reason",
        "correction.what_was_wrong",
        "correction.action_note",
      ],
    },
    exempt_fields: {
      paths: ["claim.value.text", "claim.evidence.quote", "claim.evidence.locator", "source.title"],
    },
  },
  placeholder_data: {
    sha256_denylist: [
      "0000000000000000000000000000000000000000000000000000000000000000",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    url_host_denylist: ["example.org", "example.com", "archive.example.org"],
    id_substring_denylist: ["sample", "placeholder", "test", "dummy"],
  },
};
