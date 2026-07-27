# Build specification

A static, sourced archive of India's development indicators from 2006 onward, shown as
series over time alongside the office holders of each period, deployed to GitHub Pages.
Read `CLAUDE.md` first — it contains the rules this spec assumes.

> Revised from the original specification. See DECISIONS.md #18 for what changed and why.

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
  /coverage/<slug>.json                         ds:<slug>, years covered, gaps, breaks
  /tenures/<slug>.json                          ten:<slug>, who held which office when
/schemas
  claim | entity | source | correction | coverage | tenure .schema.json
  predicates.json                       the controlled vocabulary
  verifiers.json                        handles permitted to set status: verified
  prohibited.json                       rules 6 and 9 in machine-readable form
  policy.json                           which statuses may render, and for what
/scripts
  validate.ts                           schema + referential integrity + rule checks
  build-indexes.ts                      derived lookup tables for the site build
  archive-source.ts                     fetch, hash, push to the Internet Archive
  upload-blob.ts                        mirror a document to the blobs repo
  verify-archive.ts                     confirms every source URL still resolves
  stage/                                extraction helpers (produce unverified claims)
/site                                   Astro project
/design                                 component gallery, built before the site
/.github/workflows
  validate.yml                          runs on every PR
  deploy.yml                            builds and deploys on merge to main
  archive-check.yml                     weekly link-rot report, opens an issue
```

---

## 3. Data model

Six record types. Full JSON Schema in `/schemas`.

**Source** — a document you have archived. Carries `sha256`, `retrieved_at`,
`original_url`, `archive_url` (Internet Archive), `storage_url` (object store), and
`tier` (1 = official primary, 2 = official secondary, 3 = institutional research). There
is no tier 4: the discover step ingests only from the official allowlist.

A capture is only usable if the Internet Archive actually saw the document. Save Page Now
reports success when it captures a WAF block page, so `archive-source.ts` refuses any
capture whose origin status was not 200.

**Entity** — the thing an indicator or a fact is about. Now includes `country`, `state`
and `district` alongside person, party, ministry, office, scheme, project, constituency,
house and body. An indicator series belongs to a place: `ent:country:india`,
`ent:state:madhya-pradesh`. Carries a canonical name, name variants, transliterations,
external IDs, and a `coverage` block stating from when data exists.

**Claim** — one fact about one entity, from one place in one document. Key fields:

- `assertion_type` — who is asserting this: the subject, an authority, or the project
- `value` — typed: money, integer, decimal, date, date_range, enum, string, entity_ref
- `qualifiers` — as_of date, financial year, house, constituency, ministry, case stage
- `evidence` — source_id, page, locator, optional short quote, optional snippet image
- `status` — draft, unverified, verified, disputed, superseded, withdrawn
- `extraction` — method, model, run id (audit trail for machine-assisted work)
- `verification` — who checked it, when, and optionally a second checker
- `supersedes` / `superseded_by` — the version chain

**Tenure** — who held which office, from when to when. This is the record that lets an
indicator chart carry a time-axis annotation. A tenure is evidence-backed like anything
else: it references a source. It is deliberately a separate record type rather than a
claim, because it is never a data series and must never be capable of becoming one.

**Coverage** — a dataset's year range, its gaps, and its **breaks**. A break records a
methodology discontinuity: the 2015 GDP base-year revision, the 2017 replacement of the
NSS employment rounds by PLFS, the absent 2021 Census. Rendering a line across a break
without marking it is a false statement, so breaks are data, not prose.

**Correction** — an entry in the public log: what was wrong, who reported it, what was
done, which claim replaced it. Never delete; always append.

---

## 4. Pipeline

```
discover → fetch → archive → extract → stage → verify → publish
```

1. **discover** — a per-source-type script lists candidate documents from a fixed
   allowlist of official repositories. No open web crawling.
2. **fetch** — download, compute SHA-256, record retrieval timestamp.
3. **archive** — push to Internet Archive, confirm the origin returned 200, upload to
   object store, write the Source record. A source without an archive URL cannot be used.
4. **extract** — OCR and/or model-assisted parsing produces candidate claims with
   `status: unverified`, `extraction.method` set, and the exact snippet each value came
   from. **These now publish**, labelled — so the label is load-bearing, and extraction
   quality is a publishing concern rather than a staging one.
5. **stage** — candidates land in a pull request, one per source document, so a human
   reviews a diff rather than a database.
6. **verify** — a person compares each value to the snippet, sets `status: verified` and
   `verification.verified_by`. Disagreement between two extraction passes sets
   `status: disputed` instead of picking a winner.
7. **publish** — merge triggers the build.

---

## 5. CI gates

`validate.yml` must fail the pull request if any of these are true.

- Any id-bearing field points at a record that does not exist — `subject`,
  `evidence.source_id`, `corroborating_evidence[].source_id`, `value.entity_id`,
  `qualifiers.house` / `constituency` / `ministry`, `related[].entity_id`, `supersedes`,
  `superseded_by`, `derivation.inputs`, `correction_id`, `source.superseded_by`,
  `tenure.office`, `tenure.holder`
- A claim has `status: verified` but no `verification.verified_by`
- `verification.verified_by` or `second_check_by` is absent from `schemas/verifiers.json`
- A claim about a **person** entity has a status that `schemas/policy.json` does not
  permit to render for persons. This is the editorial policy in CLAUDE.md made mechanical:
  aggregate indicators may publish unverified, figures about named individuals may not
- `evidence.page` is missing, or `evidence.quote` exceeds 200 characters
- A source lacks `sha256` or `archive_url`
- A predicate is used that is absent from `schemas/predicates.json`
- A claim's `value.type` does not match the predicate's declared `value_type`
- A qualifier listed in the predicate's `requires_qualifiers` is missing
- The subject's entity `type` is not in the predicate's `applies_to`
- An `entity_ref` value points at an entity whose type is not the predicate's `target_type`
- A claim's `assertion_type` disagrees with the predicate's declared `assertion_type`
- A superseded claim has no `superseded_by`, or the chain contains a cycle
- A record's own timeline is impossible: `extracted_at` after `created_at`, or
  `verified_at` or `updated_at` before it
- A money `amount` is inconsistent in magnitude with its `as_printed` string
- An indicator series crosses a declared **break** in its dataset's coverage record
  without the break being present in the rendered output
- A tenure overlaps another tenure for the same office without both being marked
- Any prohibited field name appears anywhere in `/data`
- Any prohibited vocabulary word appears in a label, alt text, or generated string
- Placeholder data reaches `/data`: an all-zero `sha256`, an `example.org` URL, or an id
  containing "sample"
- A file's path disagrees with the id inside it, in either direction
- An entity has claims but no `coverage` block, or lacks `inclusion_reason`
- `$comment` appears anywhere under `/data`

---

## 6. Site structure

| Route | Contents |
|---|---|
| `/` | What this is, how to read a figure, what unverified means, coverage summary, recent corrections. No hero statistics, no featured politicians. |
| `/indicator/<id>/` | One indicator, one place, over the full window. Series chart with tenure annotation, the same numbers as a table, coverage and break notices, every source listed |
| `/place/<id>/` | A country or state: every indicator held for it, each as a small series |
| `/entity/<id>/` | Claim table grouped by predicate, each row with its provenance stamp; coverage notice; timeline; related entities |
| `/entity/<id>/history/` | Full version chain including superseded claims |
| `/office/<id>/` | An office and the tenures recorded for it, with sources |
| `/source/<id>/` | Document metadata, hash, archive links, and every claim drawn from it |
| `/search/` | Pagefind across entities, indicators and claim values |
| `/data/` | Bulk download: CSV and JSON per dataset, with a data dictionary |
| `/method/` | Source hierarchy, inclusion rules, extraction and verification process, and what unverified means |
| `/corrections/` | The full log, newest first |
| `/coverage/` | Per-dataset year ranges, gaps and breaks, as a matrix |
| `/about/` | Who runs this, funding sources, contact for corrections |

Indicator pages are the product. Everything else supports them.

---

## 7. Design direction

The subject's vernacular is the filed document: the gazette notice, the audit paragraph,
the statistical handbook table. The design should feel like a well-made public register,
not a dashboard and not a newspaper.

**Signature element — the provenance stamp.** Every value on the site is followed by a
small monospace chip reading source and page. Activating it expands a panel in place
showing the locator, the retrieval date, the hash prefix, the assertion type, and a link
to the archived document. Nothing renders without one.

Because unverified figures now publish, the chip carries its status as a **word beside
the value**, visible without interaction. Colour is a second, redundant signal, repeated
as a rule down the chip's leading edge so the state survives greyscale and 400% zoom.

Built on `<details>`/`<summary>`, not a scripted button: a summary is exposed as a button
with expanded state natively and needs no JavaScript. Provenance that stops working when
a script fails to load is a defect in an archive whose premise is that any fact can be
checked. Do not set `display` on the `<summary>` — it strips the disclosure semantics —
and hide the closed panel explicitly rather than relying on the user agent.

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

Eight values, no green, no red. `--stamp` marks that a fact has been checked, not that it
is favourable. `--flagged` is purple precisely because it carries no moral reading. An
indicator rising is never green and falling is never red. Dark mode inverts paper and ink;
the three status colours lighten one step. Every pair clears 4.5:1 in both themes.

**Type**

- Body and UI: IBM Plex Sans, with IBM Plex Sans Devanagari for Hindi content
- Figures, dates, identifiers, provenance stamps: IBM Plex Mono
- Page titles only: Newsreader

Devanagari coverage is a functional requirement, not a taste decision. Set `lang`
correctly on every element so screen readers switch voices.

Scale: 14 / 16 / 20 / 28 / 40. Weights 400 and 500 only. Sentence case everywhere.

**Restraint**

No animation beyond a 120ms expand on the provenance panel. No cards, no shadows, no
icons except a single external-link glyph. Tables are the primary layout device and
should look like tables. The one place to spend effort is the stamp.

---

## 8. Charts

Charts show one indicator, for one place, over time. Rules:

- Every chart is generated server-side as inline SVG. No client-side chart runtime.
- Every chart is immediately followed by a `<table>` containing the same numbers, inside
  a `<details>` element labelled "View as table".
- Every chart carries a source line listing every source id feeding it, and a coverage
  line stating the year range, any gaps, and any breaks.
- Axes always start at zero unless the indicator is an index or a rate where zero is not
  meaningful, in which case the truncation is stated in the caption. No dual axes.
- **A series is never drawn across a break.** At a methodology discontinuity the line
  stops, a labelled marker names the break, and the next segment starts fresh. The 2015
  GDP base-year revision and the 2017 PLFS transition are not cosmetic footnotes.
- Unverified points are drawn in `--pending` and listed as unverified in the accompanying
  table. A chart whose points are mostly unverified says so in its caption.
- No chart may combine claims of different `assertion_type` without visually
  distinguishing them.
- **Tenure annotation.** Office holders appear as a thin band along the time axis,
  labelled with name and dates, at gridline weight in `--rule`. Never a fill behind the
  plot, never a series, never a segment boundary that breaks the line.
- **No chart, table, or export may aggregate an indicator by tenure.** No average under a
  term, no per-term totals, no before-and-after. See rule 10.
- Never rank places against each other. Show one place over time, or a distribution with
  the current place marked within it.
- Colour follows the status palette or a single-hue sequential ramp. Never categorical
  colour that implies party identity.

---

## 9. Accessibility

Target WCAG 2.2 AA, verified in CI with axe-core against every route.

- Semantic HTML first. Real `<table>`, `<th scope>`, `<caption>`.
- Contrast at least 4.5:1 for text, 3:1 for interface elements and chart strokes.
- Full keyboard operation with a visible focus ring at 2px `--stamp`. Skip link to main.
- Never encode meaning in colour alone — status also carries a text label, and so does
  every break marker and tenure band.
- `prefers-reduced-motion` disables the expand transition.
- All content readable at 400% zoom without horizontal scrolling on the page body. Wide
  tables scroll inside their own container.
- Bulk data available as CSV so people can use their own tools.

---

## 10. Build order

Steps 1 to 3 are done. Do not start at step 7.

1. ~~Schemas, the validator, and its tests.~~ done
2. ~~Ten claims across two entities, one source.~~ done — verified, CAG MGNREGA audit
3. ~~The provenance stamp component, in isolation.~~ done
4. The tenure record: schema, the office and person entities for one span, and the
   `/office/` route. Prove a tenure can be sourced before anything is annotated with one.
5. One indicator series end to end: RBI Handbook of Statistics, one indicator, twenty
   years, with its breaks recorded. Table only, no chart.
6. Entity, place and indicator pages rendering from real data.
7. GitHub Actions validate and deploy workflows. Get it live and ugly.
8. Coverage, breaks, corrections, method and about pages.
9. The series chart, with break handling first and tenure annotation last.
10. Search, then bulk export, then extraction tooling for the first document type.

The site should be publicly live with one sourced indicator series and one sourced tenure
before any chart exists. That ordering is deliberate: the break handling and the tenure
record are the two places this design can quietly become a scorecard, so both must be
real and boring before anything is drawn.
