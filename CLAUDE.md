# Project rules

Read this before every task. These rules are not stylistic preferences — they are the
premise of the project. Code that violates them is wrong even if it runs.

## What this project is

A static, public archive of sourced claims about Indian government and politics.
Every fact displayed on the site points to a specific page of a specific archived
document. Coverage begins wherever verified source material begins, per dataset —
there is no fixed start year.

## What this project is not

- Not a news site. No editorial copy on data pages.
- Not a scorecard. No rankings, ratings, indices, grades, or composite scores. Ever.
- Not a forum. No user accounts, comments, submissions, or any form that collects input.
- Not a dossier service. No claims about private individuals, family members, or
  anyone who is not a public office holder or candidate acting in that capacity.

## The nine rules

1. **No claim without evidence.** Every claim record must reference an existing source
   record with a page number and a locator. CI fails the build otherwise.

2. **Only `status: verified` claims render.** Everything else stays in the repo,
   visible in git, absent from the site.

3. **A model is never a verifier.** LLM or OCR extraction produces `status: unverified`
   only. Promotion to `verified` requires a human `verification.verified_by` value.
   Never write code that sets `verified` programmatically.

4. **Claims are append-only.** To change a fact, write a new claim with
   `supersedes` set and mark the old one `superseded`. Never edit a claim's `value`
   in place. Never delete a claim file.

5. **Say who is asserting.** Every claim carries `assertion_type`:
   `declared_by_subject`, `recorded_by_authority`, or `derived_by_project`.
   The UI must show this. "Declared assets of X" and "assets of X" are different claims.

6. **Neutral vocabulary only.** Never emit the words corrupt, tainted, criminal
   (as an adjective for a person), accused, scandal, failed, or successful in any
   generated content, label, or alt text. Use the `predicates.json` labels verbatim.
   Legal matters use the `case_stage` enum — a pending charge is never a conviction.

7. **Colour never encodes judgment.** The palette encodes *epistemic status*
   (verified / unverified / disputed / superseded), never good or bad. No green or red
   anywhere in the token set. If you find yourself picking a colour to mean "worse",
   stop.

8. **Show the gaps.** Where a dataset does not cover a period, render the coverage
   notice. Absence of data must never look like absence of the thing.

9. **No personal data beyond public role.** Prohibited fields: home address, phone,
   email, family member details, health, caste, religion, financial data of relatives.
   If a source contains these, do not extract them.

## Hosting constraints

Static output only, deployed to GitHub Pages via a GitHub Actions workflow.

- No server-side code, no runtime API calls, no client-side database.
- Repo must stay under 1 GB; published site under 1 GB. Source PDFs are NOT stored in
  this repo — only their SHA-256 hash, the archive URL, and the object-store URL.
- Prerender every entity page at build time. Do not fetch JSON blobs client-side except
  the search index.
- Deployment must complete in under 10 minutes. If the build slows, shard the data and
  build incrementally rather than dropping prerendering.

## Verbatim quotation

The `evidence.quote` field pinpoints where a value came from. Keep it to a short phrase.
Never reproduce paragraphs of any source. For copyrighted third-party material
(news reports, research), prefer a locator plus link over any quote at all.

## Working style

- Validate before you build: `npm run validate` must pass before `npm run build`.
- Every new predicate requires an entry in `schemas/predicates.json` first. Do not
  invent field names inline.
- Write tests for the validators before the validators.
- Small commits, one concern each. Commit messages state what changed in the data or
  the code, not both.
