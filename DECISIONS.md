# Decisions

Every place this repo diverges from the specification as originally supplied, and why.
The pristine originals are outside the repo in `../files/`. `CLAUDE.md` is unchanged —
none of the nine rules were touched. `SPEC.md` has been edited in place where it
contradicted itself; each such edit is listed below.

---

## 1. Money is stored in rupees, not paise

`claim.schema.json` said `amount` was "in the smallest whole unit of the currency" —
paise for INR. `claims.example.json` stored `42000000` against `as_printed:
"4,20,00,000"`, which is 4.2 crore **rupees**. The schema and its own example disagreed
by a factor of 100.

Resolved in favour of the example. Indian filings print rupees; storing paise would
append a constant `00` to every figure, and a missing or extra zero-pair is a silent
100× error that no schema can catch. `amount` is now `type: integer` (it was `number`,
so `42000000.50` used to validate), and `as_printed` is now **required** on money values
— without it the magnitude cross-check has no anchor.

`validate.ts` parses `as_printed` (Indian digit grouping, `Cr`/`crore`, `Lakh`/`lakh`)
and fails the build when it disagrees with `amount` by more than a rounding step.

**Reversible only while no real money data exists.** Say so now if you want paise.

## 2. `$comment` is allowed in schemas, banned under `/data`

All three schemas set `additionalProperties: false` and none declared `$comment`, but
all three supplied example files carry one. In JSON Schema 2020-12 `$comment` is a
schema keyword, not an instance exemption, so **every supplied example failed its own
schema**. Since "prove bad data is rejected" is build step 1, these would have been the
first fixtures loaded, and they'd have failed for the wrong reason.

`$comment` is now an optional string on all five record schemas, and `validate.ts`
rejects the key anywhere under `/data`. Fixtures may be annotated; published records
may not.

## 3. Tier stays `[1,2,3]`; the spec's tier-4 sentence is gone

SPEC §3 said "Tier 4 and below are not permitted as the *sole* evidence", implying tier 4
records exist as corroboration. `source.schema.json` had `enum: [1,2,3]`, so they could
not exist at all. The schema's own description — "Nothing below tier 3 may be the sole
evidence" — also excluded tier 3, the tier it was defining.

Resolved in favour of the schema, because the pipeline agrees with it: discover ingests
only from "a fixed allowlist of official repositories" and does no open web crawling, so
a tier-4 source could never enter. Both descriptions rewritten;
`corroborating_evidence` is for cross-checking one tier 1–3 source against another.

## 4. `--pending` changed from `#7A7268` to `#635C54`

§9 requires 4.5:1 for text. §7 made `--paper-sunk` the table-stripe colour, and
`--pending` is exactly the colour that lands on it — unverified and superseded rows.

| | on `--paper` | on `--paper-sunk` |
|---|---|---|
| `#7A7268` as supplied | 4.55:1 | **4.17:1 — fails** |
| `#635C54` | 6.31:1 | 5.78:1 |

`/entity/<id>/history/` would have failed axe-core on the first run. Every other token
pair had headroom: `--ink-soft` 7.25:1, `--flagged` 6.20:1, `--stamp` 10.1:1, all on
sunk paper.

`--rule` (`#D8D5CC`) sits at 1.41:1 against paper, below the 3:1 §9 asks for interface
elements. Left as supplied and treated as decorative, since table hairlines are not
required to identify a control — but flagged here so it stays a decision.

## 5. "Nine values" was eight

`--paper`, `--paper-sunk`, `--ink`, `--ink-soft`, `--rule`, `--stamp`, `--pending`,
`--flagged`. No ninth token added: links render as `--ink` with an underline, which is
what a public register does, and a dedicated link colour would collide with `--stamp`'s
"this was checked" meaning. Comment corrected to eight.

## 6. Paths drop the id prefix

Ids contain colons; NTFS cannot store them in a filename. `ent:person:modi-narendra`
becomes `/data/entities/person/modi-narendra.json`. The type directory carries what the
prefix did, so the id is reconstructible, and `validate.ts` asserts path↔id agreement in
both directions. Source ids become `/data/sources/<year>/<publisher>/<doc>.json` for the
same reason.

## 7. `verifiers.json` replaces the run-id check

SPEC §5 failed a PR when `verification.verified_by` equalled `extraction.run_id`. Those
are shaped `handle:reviewer-a` and `run-2026-07-26-eci-01`; they never collide, so the
gate always passed and rule 3 went unenforced. Replaced with an allowlist of human
handles that `verified_by` and `second_check_by` must be drawn from. Adding a handle is
a reviewable act that grants a person the authority to publish.

## 8. Four gates added that the spec's rules implied but never enforced

`predicates.json` declared `requires_qualifiers`, `applies_to`, and `assertion_type` on
nearly every predicate, and §5 checked none of them. Consequences: `case_stage` was
optional in practice on `declared_case` despite rule 6 turning on it;
`audit_observation` could attach to a person despite its own note forbidding it; a
`declared_*` predicate could ship as `recorded_by_authority`, inverting rule 5.

Also added `target_type` to the three `entity_ref` predicates (`held_office` → office,
`party_affiliation` → party, `constituency_represented` → constituency), which nothing
in the supplied files constrained — `party_affiliation → ent:scheme:foo` validated.

## 9. Placeholder data is now rejected

The sample source's `sha256` is 64 zeros: it matches `^[a-f0-9]{64}$` and passes the "a
source lacks `sha256`" gate. Its URLs are `example.org`. Both example files say "never
publish sample data" and nothing enforced it. `prohibited.json` now denylists all-zero
and empty-string hashes, `example.*` hosts, and ids containing `sample` / `placeholder` /
`test`.

## 10. `inclusion_reason` is required on entities

Both `CLAUDE.md` and the field's own description say entities without a matching
inclusion rule "do not belong in the dataset", but it was optional. It is the mechanical
form of "not a dossier service", so it is now in `required`.

## 11. Prohibited vocabulary is scoped to generated strings

Rule 6 bans the words in "generated content, label, or alt text". It does not reach
verbatim source material — an affidavit that says "accused" says "accused", and
paraphrasing a source to dodge a wordlist would be a worse failure than the word.
`prohibited.json` lists checked paths (`coverage.note`, `disambiguation`,
`what_was_wrong`, predicate labels) and exempt ones (`value.text`, `evidence.quote`,
`source.title`). "criminal" is contextual: banned as an adjective for a person, allowed
in "criminal case", "criminal proceedings" and similar.

## 12. The seed source is a CAG audit report, not an ECI affidavit

ECI was the plan. It cannot work: `affidavit.eci.gov.in` and `www.eci.gov.in` return
403, `affidavitarchive.eci.gov.in` does not resolve, and `old.eci.gov.in` times out.

The Internet Archive is blocked too, which is what settles it. Save Page Now reports
`status: success` for `affidavit.eci.gov.in` — with `http_status: 403`. It captured the
block page. That would have produced a real, resolvable `archive_url` satisfying the
"a source lacks archive_url" gate while pointing at nothing, and every claim citing it
would have been evidence for a WAF error.

`archive-source.ts` now refuses any capture whose origin status was not 200, and
`verify-archive.ts` re-checks it weekly through the wayback availability API rather than
merely confirming the URL resolves. Working around this instead would have meant
abandoning the durability guarantee, which is the point of the project.

## 13. `evidence.page` is the PDF page; the printed page goes in the locator

They differ, and not by a constant — chapter dividers are unnumbered, so the offset
shifts through the document. The PDF page is directly actionable against the
hash-pinned archived copy, which is what a reader checking a claim actually needs. The
printed page and paragraph number go in `locator`, which is where a citation belongs.

## 14. `statutory_body` added to `inclusion_reason`

The first `body` entity is a State Employment Guarantee Council, constituted under
section 12 of an Act, not by the Constitution. The supplied enum offered only
`constitutional_body`, which would have been untrue, and `administrative_unit`, which
means a geographic unit. Since decision #10 made `inclusion_reason` required, there was
no honest way to leave it blank.

## 15. The scheme entity is scoped to one State

`ent:scheme:mgnrega-madhya-pradesh`, not `ent:scheme:mgnrega`. Every figure in the
report is State-level, and `qualifiers` has no field for a State or region — so a claim
attached to a national entity would have read as a national figure, which would be
false.

The alternative is adding a `region` qualifier to the claim schema. That is the better
long-term answer if this ever holds more than one State, and it is a small change. It
was not made now because one State needs no disambiguation and a speculative qualifier
is harder to remove than to add. **Worth revisiting before a second State is loaded.**

Fragmenting a national scheme by State is also less costly here than it would be
elsewhere: the project forbids ranking entities against each other, so the usual reason
to want them unified does not apply.

## 16. Timestamps are read from the clock, and the validator now checks they cohere

The seed claims were first written with `created_at` and `extracted_at` of
`2026-07-26T23:45:00Z` — a value invented while generating them rather than read from
the clock, and roughly twenty minutes in the future. Verifying them would have recorded
ten claims verified at `23:26` that claimed to have been created at `23:45`: verified
before they existed.

Every gate passed. Nothing in the schema, the referential integrity pass, or the rule
checks looks at whether a record's own timeline is possible.

Fixed by recovering the true write times from file mtimes and the git commit
(`23:17:57Z`, `23:18:01Z`, `23:18:56Z`), and by adding two checks: `TIMELINE_INCOHERENT`
fails the build when `extracted_at` is after `created_at`, or `verified_at` or
`updated_at` before it; `TIMESTAMP_IN_FUTURE` warns on anything more than an hour ahead
of the validating machine's clock.

**Known residue.** The ten ULIDs were generated from the same invented time, so the
timestamp embedded in each id is about 26 minutes later than the record's `created_at`.
Their relative order is correct, which is what the id is for. They were not regenerated
because rule 4 forbids deleting a claim file, and the ids are the filenames. Recorded
here so that anyone decoding a ULID and finding the mismatch knows why.

## 17. The stamp is a `<details>`, not a `<button aria-expanded>`

§9 says the provenance stamp is "a `<button>` with `aria-expanded`". It is built on
`<details>`/`<summary>` instead.

A `<summary>` is exposed to assistive technology as a button and carries expanded state
natively, so nothing is lost in the accessibility tree — and it needs no JavaScript. In
an archive whose entire premise is that any fact can be checked, provenance that stops
working when a script fails to load is a real defect. The spec insists on the same thing
elsewhere: charts are server-rendered SVG specifically so they "work with JS disabled".

`<details>` also animates only on open, never on close, which is exactly what §7 permits:
"no animation beyond a 120ms expand".

If the literal `<button>` is wanted it is a small change plus roughly fifteen lines of
JavaScript, at the cost of the no-JS guarantee.

### Two defects this turned up, both invisible in a screenshot

**`display` on `<summary>` destroys its semantics.** The chip was first laid out by
putting `display: inline-flex` directly on the `<summary>`. That takes the element off
its default `list-item` display, and with it the native disclosure semantics — the
button role and expanded state simply stop being exposed. The page looked perfect.
Layout now happens on an inner `<span>`; the `<summary>` keeps its default display and
is styled only through it.

**The closed panel kept a layout box.** With `display: inline-block` on the `<details>`
— needed so the stamp sits inline after a value — the closed panel was unpainted but
still held a 1995px-tall layout box crushed into the chip's 156px column. Browsers hide
closed `<details>` content through an internal mechanism (Chromium now uses
`content-visibility` on `::details-content`) that interacts with an overridden `display`
differently across engines. Now hidden explicitly with
`.stamp:not([open]) .stamp__panel { display: none }` rather than left to the user agent.

Measured after the fixes, every foreground/background pair in both themes clears the
4.5:1 target, worst case 5.15:1 (`--pending` on a dark striped row). The page body does
not scroll sideways; only the table does, inside its own container.

---

## Two schemas written from scratch

Neither was supplied, and both are required by the spec.

- **`correction.schema.json`** — `/data/corrections/` is in the layout, `/corrections/`
  is a route, and `claim.correction_id` references it. Includes `no_change_needed` as a
  logged outcome: a report that turned out to be mistaken is still part of the record.
- **`coverage.schema.json`** — **needs your sign-off.** The spec requires
  `/data/coverage/<dataset-id>.json` and a `/coverage/` matrix but never defines what a
  dataset *is*, or how a claim belongs to one. Proposed: a dataset is a named
  (publisher × doc_type × predicate-set) stream, so membership is derivable and the real
  year range can be computed and checked against the declared one. If you had a
  different grouping in mind, this is the file to change.

## Still open

- `derived_by_project` is unusable — no predicate declares it, so `derivation` can never
  legally appear. Not a bug, but the claim schema carries machinery nothing can reach.
- Related: `attendance_days` says "let the interface compute" the percentage, while §7
  says nothing renders without a provenance stamp. A computed percentage has two source
  claims and no single page to point at. Unresolved; decide before building charts.
- No licence chosen for the data or the code.
- `/data/` bulk CSV has no column layout or data dictionary yet.
