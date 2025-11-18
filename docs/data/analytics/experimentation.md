# Experimentation Framework

Status: Draft v0.1  
Owner: Experimentation Platform (Data Science)  
Scope: WBS-020 — assignment, CUPED, SRM guardrails, preregistration, and analyst workflow.

## 1. Operating Principles

1. **Experiment catalog required**: all experiments registered in `experiment_registry` table with guardrail definitions before rollout.
2. **Sticky assignment**: variants tied to `identity_id` (fallback: `anon_id`) using salted hash to guarantee consistency.
3. **Exposure logging**: first checkpoint event (`exp.exposed`) recorded with experiment metadata.
4. **Metrics contract**: pre-declare primary, secondary, and guardrail metrics; stored in registry.
5. **Governance**: privacy review for experiments touching sensitive flows; DSAR automation removes experiment traces for deleted users.

## 2. Data Model

### Tables

- `experiment_registry`
  - `experiment_key` (PK), `name`, `description`, `status`, `owner_team`, `hypothesis`, `start_at`, `end_at`.
  - `prereg_url` (link to confluence/notion), `power_analysis` (JSON with baseline, effect size, alpha, power).
- `experiment_variant`
  - `experiment_key`, `variant_key`, `allocation_percent`, `is_control`.
- `experiment_exposure`
  - `identity_id`, `experiment_key`, `variant_key`, `exposed_at`, `context` (JSON), `iteration`.
- `experiment_metric_definition`
  - `metric_key`, `metric_type` (`primary`, `secondary`, `guardrail`), `source_model`, `aggregation`, `filters`.
- `experiment_daily_metrics`
  - `experiment_key`, `variant_key`, `metric_key`, `dt`, `value`, `users`, `cuped_value`, `p_value`, `ci_low`, `ci_high`, `srm_p_value`.

All tables live in Silver or Gold with row-level security based on `owner_team`.

## 3. Assignment Algorithm

```python
def assign(identity_id: str, experiment_key: str, variant_weights: list[tuple[str, int]]):
    seed = f"{identity_id}:{experiment_key}:{assignment_salt}"
    bucket = xxhash.xxh32(seed, seed=assignment_seed).intdigest() % 10000
    cursor = 0
    for variant_key, weight in variant_weights:
        cursor += weight * 100
        if bucket < cursor:
            return variant_key
    return variant_weights[-1][0]
```

- `assignment_salt` rotates monthly; exposures re-synchronized via `iteration` column.
- Bucketing stored in Lambda layer (Node/TypeScript) and Python (backtests).
- SRM guardrail monitors bucket share in `experiment_daily_metrics`; alert if imbalance `p < 0.01`.

## 4. CUPED Adjustment

- Pre-period metrics computed for each identity (e.g., `gmv_28d_pre`, `sessions_7d_pre`).
- For each metric:
  - Estimate covariance between pre-period (`X`) and outcome (`Y`).
  - Compute `theta = cov(X, Y) / var(X)`.
  - CUPED-adjusted outcome: `Y - theta * (X - mean(X))`.
- Stored in `cuped_value` column.
- When `var(X)` ≈ 0 or `cov(X, Y)` negative, fallback to raw metric.
- CUPED benefits reported as variance reduction percentage in dashboards (`cuped_gain_pct`).

## 5. Guardrails & Alerts

- **Sample Ratio Mismatch (SRM)**: chi-squared test comparing observed vs expected allocations. Trigger PagerDuty when `p < 0.01` sustained for 3 consecutive intervals.
- **Power Monitoring**: nightly job recomputes detectable effect size; warns when predicted duration > planned end date.
- **Stop Conditions**:
  - Guardrail breach (e.g., refund rate > 20% from control) triggers automatic fail-closed (variants disabled via AppConfig).
  - Sequential testing uses alpha-spending (Pocock boundary) for early stops.
- **Integrity Checks**: ensure exposures logged before conversion metrics count; pipeline fails otherwise.

## 6. Preregistration Workflow

1. Product/DS completes hypothesis template (objective, metric(s), MDE, risk).
2. Submit prereg doc link to `experiment_registry`.
3. Experiment council reviews: ensures guardrails, data availability, privacy compliance.
4. On approval, AppConfig flag created with variant weights, start date scheduled.
5. Post-launch, analytics automatically populates `experiment_daily_metrics`.

## 7. Analyst Workflow

- Analysts access QuickSight `Experiment Review` dashboard:
  - Variants vs control (raw + CUPED).
  - SRM status.
  - Guardrail metrics (refunds, complaints, latency).
  - Power tracking and projected end date.
- Notebook template (PySpark + Pandas) exists in `experimentation/notebooks/CUPED-template.ipynb` (future).
- Export API: `GET /experiments/{key}/summary` returns JSON with metrics, intervals, test stats.

## 8. Testing & QA

- Unit tests on assignment function ensure deterministic bucketing.
- Integration test simulates exposures to confirm SRM detection triggers.
- CUPED unit tests validate math for synthetic data (see `tools/analytics/cuped.py` and `tests/analytics/test_cuped.py`).
- Experiment pipeline CI:
  - Validate registry entries have prereg + guardrails.
  - Ensure CUPED pre-period data loaded before experiment start.

## 9. Open Items

- Automate experiment iteration rollback when guardrail triggered.
- Investigate Bayesian sequential alternative (Thompson sampling) for exploration features.
- Add visualization for variance reduction vs control to QuickSight.
