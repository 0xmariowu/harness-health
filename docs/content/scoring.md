# Scoring Algorithm

`scanner.sh` emits one JSON record per check with `measured_value`, optional `reference_value`, and a raw `score`. `scorer.js` coerces those raw scores, applies weights, and produces dimension and total scores.

## 1. Raw check scores from `scanner.sh`

`scanner.sh` produces raw scores on a 0-1 scale in six ways:

| Method | Checks | Raw score rule |
|---|---|---|
| Binary pass/fail | `F1`, `F2`, `F3`, `F4`, `F5`, `F6`, `F7`, `F9`, `W1`, `W2`, `W3`, `W4`, `W5`, `W6`, `C2`, `C3`, `C4`, `C5`, `I5`, `I7`, `S1`, `S3`, `S4`, `S5`, `S6`, `S7`, `S8`, `H4`, `H6` | `1` if the condition is met, else `0`. |
| Upper-bound score | `I2`, `C1` | `1` when `measured <= reference`, else `reference / measured`. |
| Average of upper-bound sub-scores | `I1` | Average of 4 keyword scores for `IMPORTANT`, `NEVER`, `MUST`, and `CRITICAL`, each using the upper-bound rule above. |
| Ratio score | `I3`, `I4`, `F8`, `H1`, `H2`, `S2` | Measured ratio clamped to `0-1`. `I3` = Don't-with-Because / Don't-total; `I4` = action / (action + identity); `F8` = uses-globs / total-scoped; `H1` = valid-events / total-events; `H2` = with-matcher / total; `S2` = pinned / total. |
| Range score | `I6`, `I8` | `1` inside the `[low, high]` reference range, `measured / low` below, `high / measured` above. |
| Tiered score | `H3`, `H5` | Discrete levels: `H3` = `1` all Stop hooks guarded, `0.5` some unresolvable paths, `0` any unguarded; `H5` = `1` deny covers `.env` + variants or no `.env` deny, `0.5` `.env` denied but variants missing. |

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
| Instructions | 25% | 10 |
| Workability | 18% | 10 |
| Continuity | 12% | 10 |
| Safety | 15% | 10 |
| Harness | 10% | 10 |

Check weights:

| ID | Weight | ID | Weight | ID | Weight | ID | Weight |
|---|---:|---|---:|---|---:|---|---:|
| F1 | 3 | F2 | 1 | F3 | 2 | F4 | 1 |
| F5 | 2 | F6 | 1 | F7 | 2 | F8 | 1 |
| F9 | 2 | I1 | 1 | I2 | 2 | I3 | 2 |
| I4 | 1 | I5 | 1 | I6 | 1 | I7 | 2 |
| I8 | 1 | W1 | 3 | W2 | 1 | W3 | 2 |
| W4 | 1 | W5 | 2 | W6 | 1 | C1 | 3 |
| C2 | 2 | C3 | 1 | C4 | 1 | C5 | 1 |
| S1 | 2 | S2 | 2 | S3 | 1 | S4 | 1 |
| S5 | 1 | S6 | 3 | S7 | 1 | S8 | 1 |
| H1 | 2 | H2 | 1 | H3 | 2 | H4 | 3 |
| H5 | 1 | H6 | 1 | | | | |

## 4. Total score

The total score is the weighted average of normalized dimension scores, scaled to `100`:

```text
total_raw = sum((dimension_score / dimension_max) * dimension_weight) / sum(dimension_weight)
total_score = round(total_raw * 100)
```

Because each dimension max is `10`, this is equivalent to weighting the six `0-10` dimension scores by the percentages above and converting the result to `0-100`.

## 5. Reference values

Reference values are comparison points used by some checks to turn measurements into scores. They live in `standards/reference-thresholds.json` and currently include:

- `I1_emphasis`: comfortable counts for emphasis keywords.
- `I2_density`: comfortable keyword density per 1,000 words.
- `I3_formula_ratio`: reference ratio for specific rule structure.
- `I6_length`: reference line-count range for entry files.
- `I8_total_lines`: reference non-empty-line range for total injected content.
- `C1_freshness_days`: reference age for doc freshness.
- `F4_index_threshold`: recommended file-count threshold before an index is expected.
- `H1_valid_events`: valid Claude Code hook event names.
- `H4_dangerous_patterns`: dangerous auto-approve permission patterns.

These values come from empirical sources summarized in `standards/evidence.json`. They are not pass/fail gates; they are reference points used to measure deviation and support comparison across repos.
