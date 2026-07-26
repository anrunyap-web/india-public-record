# Build specification

A static, sourced archive of claims about Indian government and politics, deployed to
GitHub Pages. Read `CLAUDE.md` first — it contains the rules this spec assumes.

---

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Site generator | Astro | Prerenders every page to static HTML, ships near-zero JS by default, content collections validate data at build time |
| Data format | JSON files in git | Diffable, reviewable in pull requests, no database to host or breach |
| Validation | Ajv against JSON Schema | Runs in CI, blocks bad data before it reaches the site |
| Search | Pagefind | Builds a static index at postbuild, works without a server |
| Charts | Observable Plot | Renders to SVG server-side, so charts work with JS disabled |
| Styling | Plain CSS with custom properties | No framework; the design is small and specific |
| Deploy | GitHub Actions → GitHub Pages | Avoids the 10-builds-per-hour cap on the default pipeline |

Node 20+. No client-side data fetching except the Pagefind index.

---

## 2. Repository layout

Ids contain colons (`ent:person:foo`), which cannot appear in a Windows filename or
directory name — NTFS reads `:` as an alternate-data-stream separator. So paths drop the
constant type prefix and let the directory carry the rest. Nothing is lost: the id is
reconstructible from the path, and `validate.ts` asserts the two agree in both directions.

```
/data
  /sources/<year>/<publisher>/<doc>.json        src:<publisher>:<doc>
  /entities/<type>/<slug>.json                  ent:<type>:<slug>
  /claims/<type>/<entity-slug>/<ulid>.json      clm:<ulid>, one atomic fact
  /corrections/<slug>.json                      cor:<slug>, public correction log
  /coverage/<slug>.json                         ds:<slug>, years covered, and gaps
/schemas
  claim | entity | source | correction | coverage .schema.json
  predicates.json                       the controlled vocabulary
  verifiers.json                        handles permitted to set status: verified
  prohibited.json                       rules 6 and 9 in machine-readable form
/scripts
  validate.ts                           schema + referential integrity + rule checks
  build-indexes.ts                      derived lookup tables for the site build
  verify-archive.ts                     confirms every source URL still resolves
  stage/                                extraction helpers (produce unverified claims)
/site                                   Astro project
/.github/workflows
  validate.yml                          runs on every PR
  deploy.yml                            builds and deploys on merge to main
  archive-check.yml                     weekly link-rot report, opens an issue
```

---

## 3. Data model

Four record types. Full JSON Schema in `/schemas`.

**Source** — a document you have archived. Carries `sha256`, `retrieved_at`,
`original_url`, `archive_url` (Internet Archive), `storage_url` (object store),
and `tier` (1 = official primary, 2 = official secondary, 3 = institutional research).
There is no tier 4: the discover step ingests only from the official allowlist, so
material weaker than tier 3 is not recordable here at all. `corroborating_evidence`
cross-checks one tier 1–3 source against another.

**Entity** — a person, party, ministry, scheme, project, constituency, or house.
Carries a canonical name, name variants, transliterations, external IDs for
cross-referencing, and a `coverage` block stating from when data exists.

**Claim** — one fact about one entity, from one place in one document. This is the
only record type that produces visible content. Key fields:

- `assertion_type` — who is asserting this: the subject, an authority, or the project
- `value` — typed: money, integer, decimal, date, date_range, enum, string, entity_ref
- `qualifiers` — as_of date, financial year, house, constituency, ministry
- `evidence` — source_id, page, locator, optional short quote, optional snippet image
- `status` — draft, unverified, verified, disputed, superseded, withdrawn
- `extraction` — method, model, run id (audit trail for machine-assisted work)
- `verification` — who checked it, when, and optionally a second checker
- `supersedes` / `superseded_by` — the version chain

**Correction** — an entry in the public log: what was wrong, who reported it, what
was done, which claim replaced it. Never delete; always append.

---

## 4. Pipeline

```
discover → fetch → archive → extract → stage → verify → publish
```

1. **discover** — a per-source-type script lists candidate documents from a fixed
   allowlist of official repositories. No open web crawling.
2. **fetch** — download, compute SHA-256, record retrieval timestamp.
3. **archive** — push to Internet Archive, upload to object store, write the Source
   record. A source without an archive URL cannot be used.
4. **extract** — OCR and/or model-assisted parsing produces candidate claims with
   `status: unverified`, `extraction.method` set, and the exact snippet each value
   came from.
5. **stage** — candidates land in a pull request, one per source document, so a human
   reviews a diff rather than a database.
6. **verify** — a person compares each value to the snippet, sets `status: verified`
   and `verification.verified_by`. Disagreement between two extraction passes sets
   `status: disputed` instead of picking a winner.
7. **publish** — merge triggers the build. Only verified claims render.

---

## 5. CI gates

`validate.yml` must fail the pull request if any of these are true. These checks are
how the editorial rules become mechanical rather than aspirational.

- Any id-bearing field points at a record that does not exist. Not just `subject` and
  `evidence.source_id` — also `corroborating_evidence[].source_id`, `value.entity_id`,
  `qualifiers.house` / `constituency` / `ministry`, `related[].entity_id`, `supersedes`,
  `superseded_by`, `derivation.inputs`, `correction_id`, and `source.superseded_by`
- A claim has `status: verified` but no `verification.verified_by`
- `verification.verified_by` or `second_check_by` is absent from `schemas/verifiers.json`.
  This replaces the original gate — "the verifier equals the extraction run id" — which
  could never fire, because a handle and a run id do not collide by accident. The
  allowlist is what actually makes rule 3 mechanical
- `evidence.page` is missing, or `evidence.quote` exceeds 200 characters
- A source lacks `sha256` or `archive_url`
- A predicate is used that is absent from `schemas/predicates.json`
- A claim's `value.type` does not match the predicate's declared `value_type`
- A qualifier listed in the predicate's `requires_qualifiers` is missing. This is what
  makes `case_stage` genuinely mandatory on `declared_case`
- The subject's entity `type` is not in the predicate's `applies_to`. This is what keeps
  `audit_observation` off person entities
- An `entity_ref` value points at an entity whose type is not the predicate's `target_type`
- A claim's `assertion_type` disagrees with the predicate's declared `assertion_type`
- A superseded claim has no `superseded_by`, or the chain contains a cycle
- A money `amount` is inconsistent in magnitude with its `as_printed` string
- Any prohibited field name appears anywhere in `/data`
- Any prohibited vocabulary word appears in a label, alt text, or generated string.
  Fields holding verbatim source text are exempt — see `schemas/prohibited.json`, which
  lists both the checked and the exempt paths
- Placeholder data reaches `/data`: an all-zero `sha256`, an `example.org` URL, or an id
  containing "sample". Both supplied example files warn against publishing sample data;
  this is that warning made mechanical
- A file's path disagrees with the id inside it, in either direction
- An entity has claims but no `coverage` block, or lacks `inclusion_reason`
- `$comment` appears anywhere under `/data`

---

## 6. Site structure

| Route | Contents |
|---|---|
| `/` | What this is, how to read a claim, coverage summary, recent corrections. No hero statistics, no featured politicians. |
| `/entity/<id>/` | Claim table grouped by predicate, each row with its provenance stamp; coverage notice; timeline; related entities |
| `/entity/<id>/history/` | Full version chain including superseded claims |
| `/source/<id>/` | Document metadata, hash, archive links, and every claim drawn from it |
| `/search/` | Pagefind across entities and claim values |
| `/data/` | Bulk download: CSV and JSON per dataset, with a data dictionary |
| `/method/` | Source hierarchy, inclusion rules, extraction and verification process |
| `/corrections/` | The full log, newest first |
| `/coverage/` | Per-dataset year ranges and known gaps, as a matrix |
| `/about/` | Who runs this, funding sources, contact for corrections |

Entity pages are the product. Everything else supports them.

---

## 7. Design direction

The subject's vernacular is the filed document: the affidavit, the gazette notice, the
audit paragraph. The design should feel like a well-made public register, not a
dashboard and not a newspaper.

**Signature element — the provenance stamp.** Every value on the site is followed by a
small monospace chip reading source and page. Activating it expands a panel in place
showing the locator, the retrieval date, the hash prefix, the assertion type, and a link
to the archived document. Nothing renders without one. This chip is the identity of the
site; build it first and build it well.

**Tokens**

```css
--paper:        #FBFAF7;   /* page */
--paper-sunk:   #F2F0EA;   /* table stripes, panels */
--ink:          #16181C;   /* primary text */
--ink-soft:     #4A4F57;   /* secondary text */
--rule:         #D8D5CC;   /* hairlines */
--stamp:        #1F3A5F;   /* verified — the only saturated colour */
--pending:      #635C54;   /* unverified, superseded */
--flagged:      #6B4A8A;   /* disputed */
```

Eight values, no green, no red. `--stamp` marks that a fact has been checked, not that
it is favourable. `--flagged` is purple precisely because it carries no moral reading.
Dark mode inverts paper and ink; the three status colours lighten one step.

**Type**

- Body and UI: IBM Plex Sans, with IBM Plex Sans Devanagari for Hindi content
- Figures, dates, identifiers, provenance stamps: IBM Plex Mono
- Page titles only: Newsreader

Devanagari coverage is a functional requirement, not a taste decision — source names,
constituencies, and scheme titles appear in Hindi and must not fall back to a system
font. Set `lang` correctly on every element so screen readers switch voices.

Scale: 14 / 16 / 20 / 28 / 40. Weights 400 and 500 only. Sentence case everywhere.

**Restraint**

No animation beyond a 120ms expand on the provenance panel. No cards, no shadows, no
icons except a single external-link glyph. Tables are the primary layout device and
should look like tables. The one place to spend effort is the stamp.

---

## 8. Charts

Charts are permitted only where they show a distribution or a series that a table makes
harder to read. Rules:

- Every chart is generated server-side as inline SVG. No client-side chart runtime.
- Every chart is immediately followed by a `<table>` containing the same numbers, inside
  a `<details>` element labelled "View as table".
- Every chart carries a source line listing every source id feeding it, and a coverage
  line stating the year range and any gaps.
- Axes always start at zero. No dual axes. No truncated scales.
- No chart may combine claims of different `assertion_type` without visually
  distinguishing them.
- Never rank entities against each other in a chart. Show one entity over time, or a
  distribution with the current entity marked within it.
- Colour in charts follows the status palette or a single-hue sequential ramp. Never
  categorical colour that implies party identity.

Suggested first charts: declared assets over successive filings for one person;
scheme allocation versus expenditure by financial year; questions asked per session
over a term.

---

## 9. Accessibility

Target WCAG 2.2 AA, verified in CI with axe-core against every route.

- Semantic HTML first. Real `<table>`, `<th scope>`, `<caption>`. The provenance stamp
  is a `<button>` with `aria-expanded`.
- Contrast at least 4.5:1 for text, 3:1 for interface elements and chart strokes.
- Full keyboard operation with a visible focus ring at 2px `--stamp`. Skip link to main.
- Never encode meaning in colour alone — status also carries a text label.
- `prefers-reduced-motion` disables the expand transition.
- All content readable at 400% zoom without horizontal scrolling.
- Bulk data available as CSV so people can use their own tools.

---

## 10. Build order

Do not start at step 4.

1. Schemas, the validator, and its tests. Prove bad data is rejected.
2. Ten hand-entered verified claims across two entities, one source. No site yet.
3. The provenance stamp component, in isolation.
4. Entity page rendering from the ten claims.
5. GitHub Actions validate and deploy workflows. Get it live and ugly.
6. Coverage notices, corrections log, method and about pages.
7. Search.
8. Bulk data export.
9. Extraction tooling for the first document type — only now.
10. Charts.

The site should be publicly live with ten claims before any extraction code exists.
That ordering is deliberate: it forces the provenance path to be real before volume
makes it tempting to skip.
