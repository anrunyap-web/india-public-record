# Verification pass — CAG Report No. 4 of 2026 (MGNREGA, Madhya Pradesh)

Ten claims are sitting at `status: unverified`. A model read the document, so
`extraction.method` is `model_assisted` and **rule 3 forbids anything higher until a
person checks each value against the page**. None of them render. Nothing is published
by working through this list — the site does not exist yet.

## The document

Open the archived copy, not the live one. The live URL can change; this copy is pinned
by hash.

- <https://github.com/anrunyap-web/india-public-record-blobs/releases/download/cag-2026/cag-mp-report-4-2026-mgnrega.pdf>
- SHA-256 `76470ece9bd4722d5f57f16bc1cdf4aed0ab2b0ba4054108c36464a8a6b52c84`

Page numbers below are **PDF pages** — type them into your reader's page box directly.
The printed page number in the document's footer is given alongside, because they differ
by a shifting offset (chapter dividers are unnumbered).

## What to check on each claim

1. The figure matches the document exactly, digit for digit.
2. The financial year is the one the document attaches to that figure.
3. The locator actually leads to the figure.
4. For the observations: the summary does not say more than the auditor said.

If a claim is right, add a `verification` block. If it is wrong, **do not edit the
value** — rule 4 makes claims append-only. Tell me and I will write a superseding claim.

```json
  "verification": {
    "verified_by": "handle:anrun",
    "verified_at": "2026-07-27T00:00:00Z"
  },
```

Add it after `"status"`, change `"status": "unverified"` to `"status": "verified"`, and
use the real time you checked it. Then run `npm run validate`.

---

## Group A — five expenditure figures

All five are on **PDF page 57** (printed page 31), in **Chart 4.1, "Funds released and
expenditure incurred"**. Read the **orange** bars, labelled *Total Expenditure*. The
blue bars are *Total fund available* and are a different number — that is the single
easiest mistake to make here.

Figures on the chart are in ₹ crore. The stored `amount` is in **rupees** (crore × 10⁷),
per DECISIONS.md #1.

| # | Claim id | FY | Chart says | Stored `amount` |
|---|---|---|---|---|
| 1 | `01KYGD2M30GHNAYDQCY1WJAG1X` | 2019-20 | ₹5186.15 crore | 51,86,15,00,000 |
| 2 | `01KYGD2M31Q565Y0RCJ1NHGMH2` | 2020-21 | ₹9513.68 crore | 95,13,68,00,000 |
| 3 | `01KYGD2M32AVNEXGH8DFGKEMY5` | 2021-22 | ₹8374.49 crore | 83,74,49,00,000 |
| 4 | `01KYGD2M332H6XK35AWAASC73K` | 2022-23 | ₹7753.61 crore | 77,53,61,00,000 |
| 5 | `01KYGD2M34BQ4D1SDEJ2YW62X0` | 2023-24 | ₹6539.72 crore | 65,39,72,00,000 |

Files are in `data/claims/scheme/mgnrega-madhya-pradesh/`.

**A free cross-check.** For each year, the chart's blue bar minus the orange bar should
equal its green *Balance* bar. All five reconcile exactly:

| FY | Available − Expenditure | Balance shown |
|---|---|---|
| 2019-20 | 5209.56 − 5186.15 = 23.41 | 23.41 |
| 2020-21 | 10013.08 − 9513.68 = 499.40 | 499.4 |
| 2021-22 | 10078.29 − 8374.49 = 1703.80 | 1703.8 |
| 2022-23 | 7784.71 − 7753.61 = 31.10 | 31.1 |
| 2023-24 | 6548.62 − 6539.72 = 8.90 | 8.9 |

If a figure you read does not reconcile, I misread the bar — say so.

---

## Group B — five audit observations

Files are in `data/claims/body/mp-state-employment-guarantee-council/`. These are on the
Council, never on a person: an audit observation is not a finding of wrongdoing by any
individual, and `predicates.json` forbids attaching one to a person entity.

### 6. `01KYGD2M35F4RP3GYV4AW9MHCZ` — FY 2021-22
**PDF page 57** (printed 31), para 4.2, the paragraph just below Chart 4.1.
Check: unutilised funds peaked at **₹1703.80 crore in 2021-22**, and that Government
accepted the position in **September 2025**, citing funds arriving late in the year.

### 7. `01KYGD2M36BP85AW42MRN4WQJ2` — FY 2021-22
**PDF page 60** (printed 34), para 4.3.1.
Check: **₹12.21 crore** paid to MP DAY-SRLM **up to July 2021** from the administrative
expenditure component, after GoI declined the proposal in **April 2019**.
Also check the word *irregular* — that is the auditor's characterisation, and the claim
should not upgrade it into anything stronger.

### 8. `01KYGD2M37CHMRA3WY8MAZW1PD` — FY 2023-24
**PDF page 61** (printed 35), para 4.4 and **footnote 8**.
Check: liabilities of **₹1217.05 crore** as on **31 March 2024**, split **₹564.76 crore**
wages and **₹652.29 crore** material. The split is in the footnote, not the body text.
Cross-check: 564.76 + 652.29 = 1217.05.

### 9. `01KYGD2M38XM9YAGK0ZSTQ9ZB0` — FY 2023-24
**PDF page 61** (printed 35), para 4.4 and **footnote 9**.
Check: **₹54.79 crore** towards wages, **4.7 lakh transactions**, attributed to
non-mapping of beneficiary accounts **with Aadhaar**.

> I first wrote this one without the word "Aadhaar", out of misplaced caution about
> rule 9. That was wrong — rule 9 prohibits an individual's personal data, and a
> systemic finding about account mapping is not that. Dropping it made the claim less
> accurate than its source. Corrected before verification, and flagged here rather than
> changed quietly.

### 10. `01KYGD2M39Y4MJET44SGCCWFDG` — FY 2023-24
**PDF page 61** (printed 35), **Table 4.2**, the yellow **Total** row only.
Check: **₹35.13 lakh** approved, **₹26.06 lakh** paid, **₹9.07 lakh** pending as on
31 March 2024, against **64,70,161** approved days of delay.
Note this table extracts with scrambled rows in any text tool — read it on the rendered
page.

---

## Then

```bash
npm run validate
```

Ten verified claims across two entities from one source is build-order step 2. Step 3
is the provenance stamp, step 5 gets it publicly live.
