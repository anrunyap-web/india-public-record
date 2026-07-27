# Project rules

Read this before every task. These rules are not stylistic preferences — they are the
premise of the project. Code that violates them is wrong even if it runs.

> Revised from the original specification. The archive now shows development indicators
> over a twenty-year window alongside the office holders of each period, and unverified
> figures render with a label rather than being withheld. The reasoning for every change,
> and what was deliberately kept, is in DECISIONS.md #18.

## What this project is

A public archive of India's development indicators from 2006 onward, shown as series over
time, alongside a record of who held office during each period. Every figure points to a
specific page of a specific archived document. A figure no person has checked still
appears — labelled, in every view, as unverified.

## What this project is not

- **Not a scorecard.** Individual indicators are shown separately and never combined into
  a composite score, index, rating, grade, or league table. "GDP growth" is a fact.
  "Development score: 7.2" is an invention. The archive publishes the first kind only.
- **Not an attribution engine.** It shows what the indicators did, and who held office
  while they did it. It never asserts that one caused the other, and never arranges a
  page so that the reader is invited to conclude it without the archive having to say it.
- **Not a news site.** No editorial copy on data pages.
- **Not a forum.** No user accounts, comments, submissions, or any form that collects input.
- **Not a dossier service.** No claims about private individuals, family members, or
  anyone who is not a public office holder or candidate acting in that capacity.

## The ten rules

1. **No claim without evidence.** Every claim record must reference an existing source
   record with a page number and a locator. CI fails the build otherwise. This did not
   change when unverified figures became publishable: unverified means *no person has
   checked it*, never *we do not know where it came from*.

2. **Unverified renders, and says so.** `verified`, `unverified` and `disputed` all
   appear on the site. `draft` and `withdrawn` never do, and `superseded` appears only in
   a version history. Every unverified or disputed value carries its status as a **word,
   adjacent to the value itself** — not hidden behind a click, not conveyed by colour
   alone. A reader who never opens a provenance panel must still know what they are
   looking at.

3. **A model is never a verifier.** LLM or OCR extraction produces `status: unverified`
   only. Promotion to `verified` requires a human `verification.verified_by` value drawn
   from `schemas/verifiers.json`. Never write code that sets `verified` programmatically.

4. **Claims are append-only.** To change a fact, write a new claim with `supersedes` set
   and mark the old one `superseded`. Never edit a claim's `value` in place. Never delete
   a claim file.

5. **Say who is asserting.** Every claim carries `assertion_type`: `declared_by_subject`,
   `recorded_by_authority`, or `derived_by_project`. The UI must show this.

6. **Neutral vocabulary only.** Never emit the words corrupt, tainted, criminal (as an
   adjective for a person), accused, scandal, failed, or successful in any generated
   content, label, or alt text. Use the `predicates.json` labels verbatim. Legal matters
   use the `case_stage` enum — a pending charge is never a conviction.

7. **Colour never encodes judgment.** The palette encodes *epistemic status* (verified /
   unverified / disputed / superseded), never good or bad. No green or red anywhere in
   the token set. An indicator moving up is not "green"; an indicator moving down is not
   "red". If you find yourself picking a colour to mean "worse", stop.

8. **Show the gaps, and show the breaks.** Where a dataset does not cover a period,
   render the coverage notice — absence of data must never look like absence of the
   thing. Where a series changes definition, base year, or survey instrument, render the
   break. A line drawn straight across a methodology change is a false statement, and
   this archive contains several: the 2015 GDP base-year revision, the 2017 replacement
   of the NSS employment rounds by PLFS, and the absence of a 2021 Census.

9. **No personal data beyond public role.** Prohibited fields: home address, phone,
   email, family member details, health, caste, religion, financial data of relatives.
   If a source contains these, do not extract them.

10. **Tenure is annotation, never analysis.** Who held office is drawn on an indicator
    chart as a neutral band along the time axis, at the same visual weight as a gridline.
    Never as a data series, never as a colour fill behind the plot, never as a chart
    segment boundary. No page, chart, table, or export may aggregate an indicator *by*
    tenure — no "average growth under", no per-term totals, no before-and-after framing.
    Computing that number is what turns an archive into an argument, and the archive does
    not make arguments.

## Editorial policy on unverified figures

Rule 2 permits unverified figures to render. This policy narrows where:

- **Statistical and aggregate indicators** may render unverified. A GDP series with three
  unchecked years is still useful and the label is honest.
- **Claims about a named individual** — assets, education, declared cases, anything from
  an affidavit — render only when `verified`. A machine-extracted financial or criminal
  figure attached to a living person is the one case where being wrong causes harm that a
  label does not undo, and it carries real defamation exposure in India.

This is a policy, not a physical law: it lives in `schemas/policy.json` and CI enforces
it. Change it there deliberately if you disagree, not by special-casing a component.

## Hosting constraints

Static output only, deployed to GitHub Pages via a GitHub Actions workflow.

- No server-side code, no runtime API calls, no client-side database.
- Repo must stay under 1 GB; published site under 1 GB. Source PDFs are NOT stored in
  this repo — only their SHA-256 hash, the archive URL, and the object-store URL.
- Prerender every entity and indicator page at build time. Do not fetch JSON blobs
  client-side except the search index.
- Deployment must complete in under 10 minutes. If the build slows, shard the data and
  build incrementally rather than dropping prerendering.

## Verbatim quotation

The `evidence.quote` field pinpoints where a value came from. Keep it to a short phrase.
Never reproduce paragraphs of any source. For copyrighted third-party material (news
reports, research), prefer a locator plus link over any quote at all.

## Working style

- Validate before you build: `npm run validate` must pass before `npm run build`.
- Every new predicate requires an entry in `schemas/predicates.json` first. Do not invent
  field names inline.
- Write tests for the validators before the validators.
- Small commits, one concern each. Commit messages state what changed in the data or the
  code, not both.
