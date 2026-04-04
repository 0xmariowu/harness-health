# Scoring Algorithm

`scanner.sh` emits one JSON record per check with `measured_value`, optional `reference_value`, and a raw `score`. `scorer.js` coerces those raw scores, applies weights, and produces dimension and total scores.

## 1. Raw check scores from `scanner.sh`

`scanner.sh` produces raw scores on a 0-1 scale in four ways:

| Method | Checks | Raw score rule |
|---|---|---|
| Binary pass/fail | `F1`, `F2`, `F3`, `F4`, `F5`, `F6`, `F7`, `W1`, `W2`, `W3`, `W4`, `W5`, `W6`, `C2`, `C3`, `C4`, `C5`, `I5`, `I7`, `S1`, `S3`, `S4`, `S5`, `S6` | `1` if the condition is met, else `0`. |
| Upper-bound score | `I2`, `C1` | `1` when `measured <= reference`, else `reference / measured`. |
| Average of upper-bound sub-scores | `I1` | Average of 4 keyword scores for `IMPORTANT`, `NEVER`, `MUST`, and `CRITICAL`, each using the upper-bound rule above. |
| Ratio / range score | `I3`, `I4`, `I6`, `S2` | `I3` uses the measured ratio directly and clamps to `0-1`; `I4` uses `action_headings / (action_headings + identity_headings)`; `I6` uses a target range where `1` is inside the range, below-range is `measured / low`, and above-range is `high / measured`; `S2` uses `pinned / total` ratio. |

Notes:

- `F4` has a reference value in `reference-thresholds.json`, but the scanner still scores it as binary: a large directory either has an index or it does not.
- `F5` measures broken reference count, but the score is still binary: any broken reference makes the check score `0`.
- `W6` uses static analysis of hook file content (not execution) to estimate hook speed.

## 2. Score coercion

`scorer.js` normalizes incoming scores before weighting:

```text
0 <= value <= 1    -> keep as-is
1 < value <= 10    -> divide by 10
10 < value <= 100  -> divide by 100
otherwise          -> 0
```

This allows scanners to emit `0-1`, `0-10`, or `0-100` values while the scorer works on a single normalized scale.

## 3. Dimension scoring

Each dimension score is a weighted average of its checks, then scaled to the dimension maximum (`10`):

```text
dimension_raw = sum(check_score * check_weight) / sum(check_weight)
dimension_score = round(dimension_raw * 10)
```

Dimension weights and maxima:

| Dimension | Weight | Max |
|---|---:|---:|
| Findability | 20% | 10 |
| Instructions | 30% | 10 |
| Workability | 20% | 10 |
| Safety | 15% | 10 |
| Continuity | 15% | 10 |

Check weights:

| ID | Weight | ID | Weight | ID | Weight | ID | Weight |
|---|---:|---|---:|---|---:|---|---:|
| F1 | 3 | F2 | 1 | F3 | 2 | F4 | 1 |
| F5 | 2 | F6 | 1 | F7 | 2 | I1 | 1 |
| I2 | 2 | I3 | 2 | I4 | 1 | I5 | 1 |
| I6 | 1 | I7 | 2 | W1 | 3 | W2 | 1 |
| W3 | 2 | W4 | 1 | W5 | 2 | W6 | 1 |
| C1 | 3 | C2 | 2 | C3 | 1 | C4 | 1 |
| C5 | 1 | S1 | 2 | S2 | 2 | S3 | 1 |
| S4 | 1 | S5 | 1 | S6 | 3 | S7 | 1 |
| S8 | 1 | | | | | | |

## 4. Total score

The total score is the weighted average of normalized dimension scores, scaled to `100`:

```text
total_raw = sum((dimension_score / dimension_max) * dimension_weight) / sum(dimension_weight)
total_score = round(total_raw * 100)
```

Because each dimension max is `10`, this is equivalent to weighting the five `0-10` dimension scores by the percentages above and converting the result to `0-100`.

## 5. Reference values

Reference values are comparison points used by some checks to turn measurements into scores. They live in `standards/reference-thresholds.json` and currently include:

- `I1_emphasis`: comfortable counts for emphasis keywords.
- `I2_density`: comfortable keyword density per 1,000 words.
- `I3_formula_ratio`: reference ratio for specific rule structure.
- `I6_length`: reference line-count range for entry files.
- `C1_freshness_days`: reference age for doc freshness.
- `F4_index_threshold`: recommended file-count threshold before an index is expected.

These values come from empirical sources summarized in `standards/evidence.json`. They are not pass/fail gates; they are reference points used to measure deviation and support comparison across repos.
