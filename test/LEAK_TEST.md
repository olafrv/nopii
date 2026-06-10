# Leak testing & detection statistics

`nopii` has **two** complementary detector checks:

| Tool | Purpose | Speed | Needs |
|---|---|---|---|
| `test/leak-check.js` (`pnpm test`) | **CI gate** — a handful of hand-picked fixtures that must always pass; fails the build on a redaction regression | instant | model |
| `test/leak-stats.mjs` (`pnpm run leak-stats`) | **Benchmark** — recall/precision/F1 over a large public PII dataset, to see *how good* detection is and where it leaks | ~2 min (1000 records) | model + dataset |

This document explains the **benchmark**: how to run it, how to read its output, and
how to improve the numbers.

## Get the dataset

The benchmark scores against the public
[ai4privacy/pii-masking-300k](https://huggingface.co/datasets/ai4privacy/pii-masking-300k)
dataset. Download an English split (e.g. `data/train/*english*.json`) to
`test/1english_openpii_30k.json` — it is **gitignored** (~100 MB) and never committed.
Each record gives a `source_text` and a gold `privacy_mask` (the true PII spans, as
`{value, start, end, label}`); the benchmark feeds `source_text` to the detector and
scores the result against that mask.

## Run it

```bash
pnpm run leak-stats                  # 1000 records, stride-sampled (~2 min)
pnpm run leak-stats -- --limit 5000  # bigger sample, tighter numbers
pnpm run leak-stats -- --limit 0     # the full dataset (~25 min)
pnpm run leak-stats -- --random --seed 42   # random sample instead of stride
pnpm run leak-stats -- --file path/to/other-split.json
pnpm run leak-stats -- --json        # machine-readable output
pnpm run leak-stats -- --help        # all flags
```

By default it takes **1000 records by deterministic stride** (every Nth record across
the whole file), so the sample is evenly spread and **reproducible** — re-running gives
the same numbers, so a change in the score reflects a code change, not sampling noise.

## Example output

A run of `pnpm run leak-stats -- --limit 1000 --examples 8` (the harmless
`objc[…]` / `constant fold ReduceMean` startup lines elided — see the CLAUDE.md
gotcha):

```
nopii leak-stats — test/1english_openpii_30k.json
sample: 1000 records (deterministic stride); detect 106.7s (106.7 ms/rec)

=== Leak rate — type-agnostic coverage (did nopii redact the span at all?) ===
  MAPPED   (labels nopii targets): leaked 1514/4523  leak  33.5%  recall  66.5%
  ALL-LABEL (every gold PII span): leaked 2926/6254  leak  46.8%  recall  53.2%

=== Per dataset label (type-agnostic coverage) ===
  label          → nopii type   gold  covered  leaked  recall
  TIME           (untargeted)    520       7     513    1.3%
  USERNAME       ACCOUNT         367     195     172   53.1%
  IDCARD         NATIONAL_ID     325     150     175   46.2%
  LASTNAME1      PERSON          324     306      18   94.4%
  DRIVERLICENSE  NATIONAL_ID     316     191     125   60.4%
  EMAIL          EMAIL           301     301       0  100.0%
  TITLE          (untargeted)    280     223      57   79.6%
  SOCIALNUMBER   NATIONAL_ID     274     193      81   70.4%
  IP             IP_ADDRESS      272     206      66   75.7%
  GIVENNAME1     PERSON          266     239      27   89.8%
  POSTCODE       ADDRESS         259     135     124   52.1%
  PASSPORT       NATIONAL_ID     256     215      41   84.0%
  BOD            (untargeted)    251       3     248    1.2%
  SEX            (untargeted)    248      65     183   26.2%
  STATE          ADDRESS         243      31     212   12.8%
  DATE           (untargeted)    243       2     241    0.8%
  CITY           ADDRESS         231     100     131   43.3%
  STREET         ADDRESS         220     189      31   85.9%
  TEL            PHONE           218     213       5   97.7%
  BUILDING       ADDRESS         213     108     105   50.7%
  COUNTRY        ADDRESS         168       4     164    2.4%
  PASS           (untargeted)    166      17     149   10.2%
  SECADDRESS     ADDRESS          86      64      22   74.4%
  LASTNAME2      PERSON           80      74       6   92.5%
  GIVENNAME2     PERSON           74      69       5   93.2%
  LASTNAME3      PERSON           30      26       4   86.7%
  GEOCOORD       (untargeted)     23       2      21    8.7%

=== Strict P/R/F1 — mapped scope (overlap AND nopii type matches) ===
  nopii type    gold    TP    FP  precision  recall   F1
  ADDRESS       1420   573    89     86.6%   40.4%   55.0%
  NATIONAL_ID   1171    30    31     49.2%    2.6%    4.9%
  PERSON         774   713  1105     39.2%   92.1%   55.0%
  ACCOUNT        367     0    17      0.0%    0.0%    0.0%
  EMAIL          301   295    19     93.9%   98.0%   95.9%
  IP_ADDRESS     272   189   129     59.4%   69.5%   64.1%
  PHONE          218   200   853     19.0%   91.7%   31.5%
  OVERALL       4523  2000  2243     47.1%   44.2%   45.6%

=== Over-redaction (detections vs ALL gold PII, any label) ===
  detections 4254; overlap real PII 3215 (75.6%); spurious 1039 (non-PII)

=== Example leaks (missed gold spans) — public synthetic data ===
  [TIME] "10:20am"  …3 - Meeting at 10:20am - luka.burg - …
  [USERNAME] "luka.burg"  …g at 10:20am - luka.burg - Meeting at 2…
  [TIME] "21"  …g - Meeting at 21 - qahil.wittau…
  [TIME] "quarter past 13"  …r - Meeting at quarter past 13 - gholamhossei…
  [TIME] "9:47 PM"  …e - Meeting at 9:47 PM - pdmjrsyoz146…
  [USERNAME] "pdmjrsyoz1460"  …g at 9:47 PM - pdmjrsyoz1460 …
  [IDCARD] "ZG29440KN"  …Zehra 2. **ZG29440KN** - **Passp…
  [IDCARD] "RX92048PN"  …235 4102 3. **RX92048PN** - **Passp…
```

> Numbers are from one 1000-record sample of the English split and will shift with the
> dataset, sample size, and any `src/ner.js` tuning. Treat them as a baseline, not a
> fixed score.

## How to read it

### The key idea: coverage vs. correct label

For a **privacy** proxy, what matters is whether a PII value was **redacted at all** —
not whether nopii guessed the right *type*. nopii replaces every detected span with a
`<TYPE_hash>` token, so a national-ID number that nopii happens to tag `PHONE` is still
tokenised and **does not leak**. The benchmark therefore reports two different things:

- **Type-agnostic coverage** (the *leak* view): a gold span is "covered" if **any**
  detected span overlaps it, regardless of label. Its complement is the **leak rate** —
  the headline number.
- **Strict type-correct** (the *quality* view): a gold span counts only if an
  overlapping detection **also has the matching nopii type**. This is the standard NER
  precision/recall/F1, useful for diagnosing the detector, but stricter than the leak
  question.

This is why, in the example, `NATIONAL_ID` shows ~46–84% *coverage* per label but only
**2.6%** strict recall: the ID numbers are being redacted (no leak), just under labels
like `PHONE`/`ACCOUNT` rather than `NATIONAL_ID`.

### Section by section

1. **Leak rate** — the headline, in two scopes:
   - **MAPPED** — only the labels nopii is configured to target (the *fair* score:
     don't penalise it for `TIME`/`DATE`/`SEX`, which it deliberately ignores).
   - **ALL-LABEL** — every gold PII span, including untargeted types. The
     total-coverage view; always lower, by design.
   `leaked X/Y` = spans with no overlapping detection; `recall` = the covered fraction.

2. **Per dataset label** — coverage broken out by the dataset's own label, with the
   nopii type each maps to (`(untargeted)` = nopii doesn't try). This pinpoints *which*
   PII kinds leak. High-leak rows on a **mapped** label are real gaps; high-leak rows on
   an `(untargeted)` label are expected.

3. **Strict P/R/F1 (mapped scope)** — per nopii type, with span-overlap matching:
   - `TP` overlap + type matches · `FP` detected this type but no gold span of it ·
     `precision = TP/(TP+FP)` (how often a detection of this type is right) ·
     `recall = TP/gold` (how many gold spans got the right type) · `F1` the harmonic
     mean. `OVERALL` is the micro-average.

4. **Over-redaction** — of all detections, how many overlap *any* real PII vs. are
   **spurious** (flagged non-PII). Spurious detections are usually harmless (you just
   tokenise a non-secret) but cost prompt fidelity and can confuse the model.

5. **Example leaks** — actual gold spans nopii missed, with surrounding context, to make
   gaps concrete. Safe to print: the dataset is **public synthetic** data, not real PII.

> Matching is **overlap-based and non-bijective** (one detection may cover several gold
> spans and vice-versa) — fine for these aggregate stats, but it is not exact-span
> token-level scoring.

## Reading the example: what it tells us

- **Strong:** `EMAIL` (F1 95.9%), `TEL`→`PHONE` (97.7% coverage), `PERSON` names
  (90–94% coverage). These are solid.
- **Redacted but mislabelled:** `NATIONAL_ID` family (`IDCARD`, `PASSPORT`,
  `SOCIALNUMBER`, `DRIVERLICENSE`) — decent *coverage* (no leak) but tagged as other
  types, so strict recall is tiny. Cosmetic unless you need correct token *types*.
- **Over-redaction:** `PHONE` (FP 853) and `PERSON` (FP 1105) fire a lot on non-matching
  spans — the regex phone pattern grabs many digit runs, and GLiNER tags many tokens
  PERSON. Net 1039 spurious detections.
- **Genuinely leaking (mapped):** address components — `STATE` (12.8%), `COUNTRY`
  (2.4%), and to a lesser degree `CITY`/`POSTCODE`/`BUILDING`. nopii enables only the
  broad `address` entity by default; the finer geo types are off.
- **Untargeted (expected to leak):** `TIME`, `DATE`, `BOD`, `SEX`, `PASS`, `GEOCOORD`,
  `TITLE` — out of nopii's scope by design.

## How to improve the detection rate

All tuning lives in `src/ner.js` and a few env vars (see `.env.example`). After **any**
change, re-run `pnpm test` (the gate) **and** `pnpm run leak-stats` to confirm recall went
up without wrecking precision — the two trade off.

1. **Enable more entity types.** Address leaks (`STATE`/`COUNTRY`/`CITY`/`POSTCODE`) come
   from only `address` being on. Add the finer geo types:
   ```bash
   GLINER_ENTITIES=person,email,phone,address,city,state,country,zipcode,\
   ip_address,national_id,credit_card,account,token
   ```
   Likely lifts address coverage; watch precision on `city`/`country` (common words).

2. **Lower the threshold** for higher recall:
   ```bash
   GLINER_THRESHOLD=0.4   # default 0.5; lower = more spans flagged
   ```
   Below ~0.4 GLiNER starts tagging pronouns/filler as `PERSON` — the `STOPWORDS` guard
   in `src/ner.js` absorbs the common ones; extend it if new false positives appear.

3. **Tighten over-redacting regex.** The `PHONE` pattern (`src/ner.js` `REGEX_PATTERNS`)
   is broad and drives most spurious detections. Constrain it (require separators / a
   leading `+` / a minimum digit count) to cut FPs — re-check that real phone recall
   (97.7%) holds.

4. **Improve the label-correctness (strict F1), not just coverage.** If you need national
   IDs tagged `NATIONAL_ID` rather than `PHONE`, add targeted regexes for passport /
   SSN / driver-licence shapes (they have recognisable formats) so the right type wins
   `mergeSpans`.

5. **Revisit loose mappings.** `USERNAME→ACCOUNT` and `CARDISSUER→CREDIT_CARD` in
   `test/leak-stats.mjs` are soft. If you start targeting usernames, enable the GLiNER
   `user_id` entity and remap. The map is an editable table at the top of the script —
   keep it in step with `GLINER_ENTITIES`.

6. **Grow the CI fixtures.** When the benchmark surfaces a real gap, add a minimal case to
   `test/pii-fixtures.js` so `pnpm test` guards it forever. The benchmark *finds* gaps;
   the fixtures *lock in* the fixes.

## Caveats

- **Synthetic data.** ai4privacy is generated, not real prompts — distributions
  (formats, name styles) differ from your traffic. Use it for relative comparisons and
  gap-finding, not as an absolute guarantee.
- **Label noise.** The gold mask has debatable spans (e.g. `TIME` = `"21"`); some "leaks"
  on untargeted labels are not things you'd ever want redacted.
- **Sampling.** The default is 1000 of ~30k records; bump `--limit` (or use `--limit 0`)
  before trusting small per-label rows.
- **It's a benchmark, not the gate.** `leak-check.js` stays the deterministic CI check;
  `leak-stats` is the on-demand measurement you run while tuning.
