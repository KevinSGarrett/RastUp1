# Analytics Cost Controls

Status: Draft v0.1  
Owner: Data Platform FinOps  
Scope: WBS-020 — budgets, query limits, rightsizing, anomaly detection for analytics stack.

## 1. Cost Baselines

| Service | Monthly Budget | Notes |
|---------|----------------|-------|
| S3 (Bronze/Silver/Gold) | \$2,500 | Includes Glacier Deep Archive after 180 days. |
| Kinesis + Firehose | \$1,200 | Based on 300 RPS peak, 5 KB avg payload. |
| Glue (batch + streaming) | \$1,000 | 20 DPUs baseline + spot usage. |
| Athena | \$3,000 | Workgroup scan budgets; assume 30 TB scanned/month. |
| QuickSight | \$1,200 | 40 author seats, 150 reader sessions, 30 GB SPICE. |
| Metabase (EC2/RDS) | \$400 | Optional self-hosted. |

Budgets tracked in AWS Budgets with daily email + Slack alerts at 60/80/100%.

## 2. Query Governance

- Athena Workgroups:
  - `analytics-prod`: max 250 TB scan/query, timeout 20 min, enforced `enforce-workgroup-configuration`.
  - `analytics-ad-hoc`: max 5 TB scan/query, timeout 5 min, for exploration.
  - `analytics-sandbox`: sandbox with 1 TB cap; disabled in working hours if abuse detected.
- Query tags enforced via Lake Formation; each query must include `purpose` tag (dashboard, analysis, pipeline).
- Auto-terminate:
  - Lambda monitors `GetQueryExecution`; cancels queries > 50% budget or no partition filter.
  - Offending query triggers Slack alert with SQL excerpt.

## 3. Storage Optimization

- Bronze:
  - Firehose merges micro-batches into 128 MB Parquet shards nightly.
  - Lifecycle rules: 0-30 days S3 Standard, 30-90 days S3 Standard-IA, 90-400 days Glacier Instant retrieval, >400 days Deep Archive (unless legal hold).
- Silver:
  - Compaction job ensures 256 MB parquet files; sorts by `dt`, `city`.
  - Use `delta` format (Iceberg/Apache Hudi optional) to support MERGE and vacuum.
- Gold:
  - CTAS outputs partitioned tables with `dt`, `channel_group`, `city`.
  - Maintain aggregated summary tables for dashboards to reduce repeated scans.

## 4. Compute Rightsizing

- Glue:
  - Use Glue 4.0 with Autoscaling; monitor DPU usage; downscale jobs with `rows_processed` < threshold.
  - Streaming jobs configured with checkpointing and auto-paused when idle > 30 min.
- Lambda:
  - Ingestion Lambda sized at 512 MB, 1 min timeout; monitor `throttles` and adjust concurrency.
  - Attribution verification uses Provisioned Concurrency during campaign launches.
- QuickSight:
  - Limit SPICE refresh concurrency to 2; schedule off-peak.
  - Archive unused dashboards after 60 days inactivity.

## 5. Anomaly Detection

- CloudWatch metrics:
  - `AthenaBytesScanned` aggregated per workgroup; anomaly detection band with 2.5σ.
  - `S3BucketSizeBytes` tracked daily; growth > 15% week-over-week triggers FinOps review.
  - `GlueDpuUsage` spikes > 30% baseline raise slack alert.
- `cost_controls.anomalies` table stores events (`service`, `metric`, `value`, `expected_range`, `detected_at`, `status`).
- Weekly FinOps report summarises anomalies, actions, savings.

## 6. Guardrail Automation

- `tools/cost/enforce_partitions.py` (future) rewrites queries lacking partition filters by adding `WHERE dt >= current_date - interval '30' day`.
- Step Functions:
  - `cost-throttle` toggles QuickSight refresh schedule when SPICE budget consumed > 90%.
  - `cost-cleanup` reclaims orphaned Athena result sets > 2 days old.
- IAM policies restrict `UNLOAD` to staging bucket with lifecycle expiry to avoid leftover data.

## 7. Reporting

- QuickSight `Analytics FinOps` dashboard showing:
  - Monthly spend vs budget.
  - Top Athena queries by bytes scanned.
  - Storage growth by layer (Bronze/Silver/Gold).
  - Cost savings from compaction and SPICE optimisations.
- Monthly review with Finance + Data Platform to adjust budgets.

## 8. Open Items

- Evaluate AWS Cost Anomaly Detection integration with custom SNS piping into PagerDuty.
- Automate offloading of historical Gold partitions to Redshift Spectrum if analytics demand increases.
- Consider data sharing agreements requiring chargeback to business units.
