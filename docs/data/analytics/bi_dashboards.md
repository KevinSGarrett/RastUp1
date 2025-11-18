# BI Dashboard Catalog

Status: Draft v0.1  
Owner: Analytics Engineering  
Scope: WBS-020 — marketplace health, growth, trust & safety, finance, and support dashboards.

## Dashboard Inventory

| Dashboard | Workspace | Primary Audience | Data Sources | Refresh | Notes |
|-----------|-----------|------------------|--------------|---------|-------|
| Marketplace Health | Executive | Leadership, GM | `kpi_gmv_daily`, `kpi_conversion_funnel`, `dim_city` | Daily 06:30 local | Includes funnel drop-offs, city heatmap, Safe-Mode split. |
| Supply Growth | Operations | City Ops, Supply BD | `fact_service_profile`, `kpi_seller_activation`, `kpi_studio_verification_rate` | Hourly | Tracks onboarding, verification backlog, activation velocity. |
| Demand Growth | Growth | Growth, Marketing | `fact_attribution_conversions`, `kpi_paid_attributed_gmv_daily`, `kpi_nonproof_conversion_rate` | Hourly | Highlights paid vs organic, CAC proxy, click-proof coverage. |
| Trust & Safety | Trust | Trust Analysts, Risk Ops | `fact_reviews`, `fact_idv_bg`, `kpi_risk_buckets`, `quality_alerts` | 30 min | Moderation queue, IDV funnel, dispute resolutions, risk flags. |
| Finance & Revenue | Finance | Finance FP&A, Accounting | `kpi_gmv_daily`, `fact_payments`, `fact_payouts`, `finance_recon_status` | Daily 05:30 | Shows GMV, Take Rate, payout backlog, reconciliation status. |
| Support Experience | Support | Support Managers | `fact_notifications`, `support_ticket_metrics`, `csat_scores` | 15 min | Ticket backlog, SLA adherence, CSAT by channel and topic. |
| Experiment Review | Experimentation | Data Science, Product | `experiment_daily_metrics`, `experiment_registry` | Daily | CUPED vs raw metrics, SRM alerts, guardrail trendlines. |
| Data Quality Ops | Data Platform | Data Platform SRE | `data_quality_run`, `data_incident`, `dsar_request` | 15 min | Tracks data pipeline health, DSAR backlog, retention jobs. |

## QuickSight Configuration

- Workspaces provisioned per department with IAM identity center groups.
- SPICE datasets sized to keep within 30 GB budget:
  - Marketplace: 6 GB (reduced to 90 days of data).
  - Growth: 5 GB (click-proof metrics).
  - Trust: 4 GB (moderation).
  - Finance: 8 GB (multi-year GMV aggregates).
  - Support: 3 GB.
- Refresh cadences use staggered schedule to avoid concurrency spikes.
- Row-level security:
  - City Ops limited to assigned cities via `dim_city.city_owner_group`.
  - Trust dashboards hide PII columns with column-level masking.

## Metabase Self-Serve Models

- `public.marketplace_health` (view) — sanitized metrics accessible by Product.
- `public.growth_campaign_summary` — aggregated by campaign/channel with proof flags.
- `public.support_ticket_summary` — aggregated stats without PII.
- Data dictionary stored in `docs/data/analytics/bi_dictionary.md` (future).

## Operational Guidelines

- Dashboard owners defined in QuickSight metadata; must keep runbooks updated for outages.
- Changes to KPI definitions require:
  1. Update to `docs/data/semantic_layer/metrics_catalog.yaml`.
  2. Approval from respective domain owner (Finance, Trust, Growth).
  3. Backfill plan documented.
- Each dashboard includes SLA tile showing freshness indicator (green ≤ SLA, yellow ≤ 1.5×, red otherwise).

## Pending Enhancements

- Add anomaly detection overlays for GMV, bookings, and support ticket volume.
- Implement incremental SPICE refresh using partition filters to reduce runtime.
- Embed dashboards into Admin console with SSO + row-level security enforcement.
