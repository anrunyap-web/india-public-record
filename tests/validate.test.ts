import { describe, it, expect } from "vitest";
import { validateArchive, idToPath, pathToId, parseAsPrinted } from "../scripts/validate.js";
import type { Finding } from "../scripts/validate.js";
import { archive, claim, entity, constituency, party, source, registries, ulid } from "./helpers.js";

/** Rule codes present in the findings, for readable assertions. */
const codes = (f: Finding[]) => f.filter((x) => x.severity === "error").map((x) => x.rule);

/** The baseline every test mutates. Person + constituency + party + source + one claim. */
const base = () => archive(entity(), constituency(), party(), source(), claim());

describe("a well-formed archive", () => {
  it("produces no errors", () => {
    const f = validateArchive(base(), registries());
    expect(codes(f)).toEqual([]);
  });
});

describe("rule 1 — no claim without evidence", () => {
  it("rejects a claim whose source does not exist", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        evidence: { source_id: "src:eci:does-not-exist", page: 7, locator: "Part A" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("REF_MISSING");
  });

  it("rejects a claim whose subject entity does not exist", () => {
    const f = validateArchive(
      archive(source(), claim({ subject: "ent:person:ghost" })),
      registries(),
    );
    expect(codes(f)).toContain("REF_MISSING");
  });

  it("follows references the original spec never listed", () => {
    // qualifiers.constituency, value.entity_id, related[].entity_id, derivation.inputs,
    // corroborating_evidence[].source_id — all id-bearing, none named in SPEC section 5.
    const f = validateArchive(
      archive(entity(), source(), claim({
        qualifiers: { as_of: "2024-04-12", constituency: "ent:constituency:nowhere" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("REF_MISSING");
  });
});

describe("rule 3 — a model is never a verifier", () => {
  it("rejects a verifier absent from the allowlist", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        verification: { verified_by: "handle:some-bot", verified_at: "2026-07-26T11:02:00Z" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("VERIFIER_NOT_ALLOWLISTED");
  });

  it("rejects a second checker absent from the allowlist", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        verification: {
          verified_by: "handle:reviewer-a",
          verified_at: "2026-07-26T11:02:00Z",
          second_check_by: "handle:run-2026-07-26-eci-01",
        },
      })),
      registries(),
    );
    expect(codes(f)).toContain("VERIFIER_NOT_ALLOWLISTED");
  });

  it("rejects verified status with no verification block at all", () => {
    const c = claim();
    delete (c.data as Record<string, unknown>).verification;
    const f = validateArchive(archive(entity(), constituency(), party(), source(), c), registries());
    expect(codes(f)).toContain("SCHEMA");
  });
});

describe("predicate registry", () => {
  it("rejects a predicate absent from predicates.json", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({ predicate: "integrity_rating" })),
      registries(),
    );
    expect(codes(f)).toContain("PREDICATE_UNKNOWN");
  });

  it("rejects a value type that disagrees with the predicate", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        value: { type: "string", text: "four point two crore" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("VALUE_TYPE_MISMATCH");
  });

  it("rejects an enum code the predicate does not declare", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        predicate: "election_outcome",
        assertion_type: "recorded_by_authority",
        value: { type: "enum", code: "won_handsomely" },
        qualifiers: { as_of: "2024-06-04", constituency: "ent:constituency:kolar" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("ENUM_CODE_UNKNOWN");
  });

  it("rejects an assertion_type that disagrees with the predicate", () => {
    // rule 5: "declared assets of X" and "assets of X" are different claims.
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        assertion_type: "recorded_by_authority",
      })),
      registries(),
    );
    expect(codes(f)).toContain("ASSERTION_TYPE_MISMATCH");
  });
});

describe("required qualifiers", () => {
  it("rejects a claim missing a qualifier the predicate requires", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({ qualifiers: {} })),
      registries(),
    );
    expect(codes(f)).toContain("QUALIFIER_MISSING");
  });

  it("rejects declared_case with no case_stage", () => {
    // The reason this gate exists. Rule 6: a pending charge is never a conviction,
    // which is unenforceable if the stage can simply be absent.
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        predicate: "declared_case",
        value: { type: "string", text: "IPC s. 147 — one charge" },
        qualifiers: { as_of: "2024-04-12" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("QUALIFIER_MISSING");
  });

  it("accepts declared_case once case_stage is present", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        predicate: "declared_case",
        value: { type: "string", text: "IPC s. 147 — one charge" },
        qualifiers: { as_of: "2024-04-12", case_stage: "charges_framed" },
      })),
      registries(),
    );
    expect(codes(f)).toEqual([]);
  });
});

describe("applies_to and target_type", () => {
  it("keeps audit_observation off a person entity", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        predicate: "audit_observation",
        assertion_type: "recorded_by_authority",
        value: { type: "string", text: "Utilisation certificates not furnished for the year." },
        qualifiers: { financial_year: "2023-24" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("APPLIES_TO_MISMATCH");
  });

  it("rejects an entity_ref pointing at the wrong entity type", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        predicate: "party_affiliation",
        assertion_type: "recorded_by_authority",
        value: { type: "entity_ref", entity_id: "ent:constituency:kolar" },
        qualifiers: {},
      })),
      registries(),
    );
    expect(codes(f)).toContain("TARGET_TYPE_MISMATCH");
  });

  it("accepts an entity_ref of the declared target type", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        predicate: "party_affiliation",
        assertion_type: "recorded_by_authority",
        value: { type: "entity_ref", entity_id: "ent:party:janata-front" },
        qualifiers: {},
      })),
      registries(),
    );
    expect(codes(f)).toEqual([]);
  });
});

describe("rule 4 — claims are append-only", () => {
  it("rejects a superseded claim with no superseded_by", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({ status: "superseded" })),
      registries(),
    );
    expect(codes(f)).toContain("SCHEMA");
  });

  it("rejects a supersede cycle", () => {
    const a = `clm:${ulid("FG")}`;
    const b = `clm:${ulid("FH")}`;
    const f = validateArchive(
      archive(
        entity(), constituency(), party(), source(),
        claim({ id: a, status: "superseded", superseded_by: b }),
        claim({ id: b, status: "superseded", superseded_by: a }),
      ),
      registries(),
    );
    expect(codes(f)).toContain("SUPERSEDE_CYCLE");
  });

  it("rejects superseded_by pointing at a claim that does not exist", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        status: "superseded",
        superseded_by: `clm:${ulid("ZZ")}`,
      })),
      registries(),
    );
    expect(codes(f)).toContain("REF_MISSING");
  });
});

describe("money magnitude", () => {
  it("parses Indian digit grouping", () => {
    expect(parseAsPrinted("4,20,00,000")).toBe(42000000);
    expect(parseAsPrinted("Rs. 15,00,000")).toBe(1500000);
    expect(parseAsPrinted("1,23,45,678")).toBe(12345678);
  });

  it("parses crore and lakh suffixes", () => {
    expect(parseAsPrinted("Rs. 4.2 Cr")).toBe(42000000);
    expect(parseAsPrinted("4.2 crore")).toBe(42000000);
    expect(parseAsPrinted("15 lakh")).toBe(1500000);
  });

  it("reads Nil as zero", () => {
    expect(parseAsPrinted("Nil")).toBe(0);
    expect(parseAsPrinted("NIL")).toBe(0);
  });

  it("catches the 100x error that storing paise would have caused", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        value: { type: "money", amount: 4200000000, currency: "INR", as_printed: "4,20,00,000" },
      })),
      registries(),
    );
    expect(codes(f)).toContain("MONEY_MAGNITUDE_MISMATCH");
  });

  it("tolerates rounding in a printed figure", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        value: { type: "money", amount: 41987650, currency: "INR", as_printed: "Rs. 4.2 Cr" },
      })),
      registries(),
    );
    expect(codes(f)).toEqual([]);
  });

  it("warns rather than fails when as_printed cannot be parsed", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        value: { type: "money", amount: 42000000, currency: "INR", as_printed: "see annexure" },
      })),
      registries(),
    );
    expect(codes(f)).toEqual([]);
    expect(f.map((x) => x.rule)).toContain("MONEY_AS_PRINTED_UNPARSEABLE");
  });
});

describe("rule 9 — no personal data beyond public role", () => {
  it("rejects a prohibited field name at any depth", () => {
    const f = validateArchive(
      archive(entity({ external_ids: { eci_candidate: "123", phone: "0000000000" } }),
        constituency(), party(), source(), claim()),
      registries(),
    );
    expect(codes(f)).toContain("PROHIBITED_FIELD");
  });

  it("rejects a family field even though Form 26 prints one", () => {
    // external_ids and names_local are the only open objects in the schemas, so they
    // are the only places a prohibited key can hide from additionalProperties: false.
    const f = validateArchive(
      archive(entity({ external_ids: { spouse_name: "…" } }),
        constituency(), party(), source(), claim()),
      registries(),
    );
    expect(codes(f)).toContain("PROHIBITED_FIELD");
  });
});

describe("rule 6 — neutral vocabulary", () => {
  it("rejects a prohibited word in an editorial string", () => {
    const f = validateArchive(
      archive(entity({
        coverage: { from: "2024-04-01", note: "The 2019 scan failed to digitise." },
      }), constituency(), party(), source(), claim()),
      registries(),
    );
    expect(codes(f)).toContain("PROHIBITED_VOCABULARY");
  });

  it("leaves verbatim source text alone", () => {
    // An affidavit that says "accused" says "accused". Paraphrasing a source to dodge a
    // wordlist would be a worse failure than the word.
    const f = validateArchive(
      archive(entity(), constituency(), party(), source(), claim({
        predicate: "declared_case",
        value: { type: "string", text: "accused under IPC s. 147, as printed in the filing" },
        qualifiers: { as_of: "2024-04-12", case_stage: "charges_framed" },
      })),
      registries(),
    );
    expect(codes(f)).toEqual([]);
  });

  it("allows 'criminal' in legal usage but not as an adjective for a person", () => {
    const ok = validateArchive(
      archive(entity({
        coverage: { from: "2024-04-01", note: "Covers criminal cases as declared in the affidavit." },
      }), constituency(), party(), source(), claim()),
      registries(),
    );
    expect(codes(ok)).toEqual([]);

    const bad = validateArchive(
      archive(entity({
        coverage: { from: "2024-04-01", note: "Covers criminal politicians in the state." },
      }), constituency(), party(), source(), claim()),
      registries(),
    );
    expect(codes(bad)).toContain("PROHIBITED_VOCABULARY");
  });
});

describe("placeholder data", () => {
  it("rejects the all-zero hash that passes the pattern check", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(),
        source({ sha256: "0".repeat(64) }), claim()),
      registries(),
    );
    expect(codes(f)).toContain("PLACEHOLDER_DATA");
  });

  it("rejects an example.org URL", () => {
    const f = validateArchive(
      archive(entity(), constituency(), party(),
        source({ storage_url: "https://archive.example.org/sources/x.pdf" }), claim()),
      registries(),
    );
    expect(codes(f)).toContain("PLACEHOLDER_DATA");
  });

  it("rejects an id containing 'sample'", () => {
    const f = validateArchive(
      archive(entity({ id: "ent:person:sample-candidate-0001" }),
        constituency(), party(), source(), claim({ subject: "ent:person:sample-candidate-0001" })),
      registries(),
    );
    expect(codes(f)).toContain("PLACEHOLDER_DATA");
  });
});

describe("$comment", () => {
  it("is rejected under /data", () => {
    const f = validateArchive(
      archive(entity({ $comment: "SAMPLE RECORD" }), constituency(), party(), source(), claim()),
      registries(),
    );
    expect(codes(f)).toContain("COMMENT_IN_DATA");
  });
});

describe("entities", () => {
  it("rejects an entity with no inclusion_reason", () => {
    const e = entity();
    delete (e.data as Record<string, unknown>).inclusion_reason;
    const f = validateArchive(archive(e, constituency(), party(), source(), claim()), registries());
    expect(codes(f)).toContain("SCHEMA");
  });

  it("rejects an entity that has claims but no coverage block", () => {
    const e = entity();
    delete (e.data as Record<string, unknown>).coverage;
    const f = validateArchive(archive(e, constituency(), party(), source(), claim()), registries());
    expect(codes(f)).toContain("SCHEMA");
  });
});

describe("path and id agreement", () => {
  it("maps ids to colon-free paths", () => {
    expect(idToPath("ent:person:asha-ramesh", "entity"))
      .toBe("data/entities/person/asha-ramesh.json");
    expect(idToPath("src:eci:kolar-2024-form26", "source", { year: 2024 }))
      .toBe("data/sources/2024/eci/kolar-2024-form26.json");
    expect(idToPath("cor:2026-07-assets-misread", "correction"))
      .toBe("data/corrections/2026-07-assets-misread.json");
    expect(idToPath("ds:eci-affidavits", "coverage"))
      .toBe("data/coverage/eci-affidavits.json");
  });

  it("round-trips back to the id", () => {
    expect(pathToId("data/entities/person/asha-ramesh.json", "entity"))
      .toBe("ent:person:asha-ramesh");
    expect(pathToId("data/sources/2024/eci/kolar-2024-form26.json", "source"))
      .toBe("src:eci:kolar-2024-form26");
  });

  it("rejects a file whose path disagrees with the id inside it", () => {
    const e = entity();
    e.path = "data/entities/person/someone-else.json";
    const f = validateArchive(archive(e, constituency(), party(), source(), claim()), registries());
    expect(codes(f)).toContain("PATH_ID_MISMATCH");
  });
});
