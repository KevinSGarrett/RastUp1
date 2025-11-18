# Usage and Cost Tracking

**Purpose**: Track LLM usage, CI costs, and resource consumption  
**Owner**: AGENT-4, DevOps

---

## Overview

This document defines how we track usage and costs for:
- LLM API calls (OpenAI, Anthropic)
- CI/CD runs (GitHub Actions)
- Cloud infrastructure (AWS)
- External services (Stripe, Twilio, etc.)

## LLM Usage Tracking

### Model Decision Log

All LLM calls logged to `ops/model-decisions.jsonl`:

```jsonl
{
  "timestamp": "2025-11-18T14:30:00Z",
  "agent": "AGENT-4",
  "wbs": "WBS-023",
  "model": "claude-sonnet-4.5",
  "provider": "anthropic",
  "purpose": "Generate documentation",
  "input_tokens": 15000,
  "output_tokens": 8000,
  "cost_usd": 0.345,
  "duration_ms": 12500,
  "success": true
}
```

### Fields

- **timestamp**: ISO 8601 timestamp
- **agent**: Which agent made the call
- **wbs**: WBS item being worked on
- **model**: Model name (e.g., "gpt-4", "claude-sonnet-4.5")
- **provider**: Provider (openai, anthropic, etc.)
- **purpose**: Why the call was made
- **input_tokens**: Input token count
- **output_tokens**: Output token count
- **cost_usd**: Estimated cost in USD
- **duration_ms**: Call duration in milliseconds
- **success**: Whether call succeeded

### Cost Calculation

#### OpenAI Pricing (as of 2025-11-18)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| GPT-4 Turbo | $10.00 | $30.00 |
| GPT-4 | $30.00 | $60.00 |
| GPT-3.5 Turbo | $0.50 | $1.50 |

#### Anthropic Pricing (as of 2025-11-18)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Claude Sonnet 4.5 | $3.00 | $15.00 |
| Claude Sonnet 3.5 | $3.00 | $15.00 |
| Claude Opus | $15.00 | $75.00 |

### Tracking Script

```python
# ops/qa/scripts/track-llm-usage.py
import json
from datetime import datetime
from pathlib import Path

def log_llm_call(
    agent: str,
    wbs: str,
    model: str,
    provider: str,
    purpose: str,
    input_tokens: int,
    output_tokens: int,
    duration_ms: int,
    success: bool = True,
):
    """Log LLM API call to model-decisions.jsonl"""
    
    # Calculate cost
    cost = calculate_cost(provider, model, input_tokens, output_tokens)
    
    # Create log entry
    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "agent": agent,
        "wbs": wbs,
        "model": model,
        "provider": provider,
        "purpose": purpose,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": round(cost, 4),
        "duration_ms": duration_ms,
        "success": success,
    }
    
    # Append to log file
    log_file = Path("ops/model-decisions.jsonl")
    with open(log_file, "a") as f:
        f.write(json.dumps(entry) + "\n")

def calculate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate cost based on provider and model"""
    
    pricing = {
        "anthropic": {
            "claude-sonnet-4.5": {"input": 3.00, "output": 15.00},
            "claude-sonnet-3.5": {"input": 3.00, "output": 15.00},
            "claude-opus": {"input": 15.00, "output": 75.00},
        },
        "openai": {
            "gpt-4-turbo": {"input": 10.00, "output": 30.00},
            "gpt-4": {"input": 30.00, "output": 60.00},
            "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
        },
    }
    
    rates = pricing.get(provider, {}).get(model, {"input": 0, "output": 0})
    
    input_cost = (input_tokens / 1_000_000) * rates["input"]
    output_cost = (output_tokens / 1_000_000) * rates["output"]
    
    return input_cost + output_cost

# Usage example
log_llm_call(
    agent="AGENT-4",
    wbs="WBS-023",
    model="claude-sonnet-4.5",
    provider="anthropic",
    purpose="Generate documentation",
    input_tokens=15000,
    output_tokens=8000,
    duration_ms=12500,
)
```

### Analysis Script

```python
# ops/qa/scripts/analyze-llm-usage.py
import json
from collections import defaultdict
from datetime import datetime, timedelta

def analyze_llm_usage(days: int = 7):
    """Analyze LLM usage for past N days"""
    
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    stats = {
        "by_agent": defaultdict(lambda: {"calls": 0, "tokens": 0, "cost": 0}),
        "by_model": defaultdict(lambda: {"calls": 0, "tokens": 0, "cost": 0}),
        "by_wbs": defaultdict(lambda: {"calls": 0, "tokens": 0, "cost": 0}),
        "total": {"calls": 0, "tokens": 0, "cost": 0},
    }
    
    with open("ops/model-decisions.jsonl") as f:
        for line in f:
            entry = json.loads(line)
            timestamp = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
            
            if timestamp < cutoff:
                continue
            
            tokens = entry["input_tokens"] + entry["output_tokens"]
            cost = entry["cost_usd"]
            
            # By agent
            stats["by_agent"][entry["agent"]]["calls"] += 1
            stats["by_agent"][entry["agent"]]["tokens"] += tokens
            stats["by_agent"][entry["agent"]]["cost"] += cost
            
            # By model
            stats["by_model"][entry["model"]]["calls"] += 1
            stats["by_model"][entry["model"]]["tokens"] += tokens
            stats["by_model"][entry["model"]]["cost"] += cost
            
            # By WBS
            stats["by_wbs"][entry["wbs"]]["calls"] += 1
            stats["by_wbs"][entry["wbs"]]["tokens"] += tokens
            stats["by_wbs"][entry["wbs"]]["cost"] += cost
            
            # Total
            stats["total"]["calls"] += 1
            stats["total"]["tokens"] += tokens
            stats["total"]["cost"] += cost
    
    return stats

def print_report(stats):
    """Print usage report"""
    
    print(f"LLM Usage Report (Last 7 Days)")
    print("=" * 60)
    
    print(f"\nTotal:")
    print(f"  Calls: {stats['total']['calls']}")
    print(f"  Tokens: {stats['total']['tokens']:,}")
    print(f"  Cost: ${stats['total']['cost']:.2f}")
    
    print(f"\nBy Agent:")
    for agent, data in sorted(stats['by_agent'].items()):
        print(f"  {agent}:")
        print(f"    Calls: {data['calls']}")
        print(f"    Tokens: {data['tokens']:,}")
        print(f"    Cost: ${data['cost']:.2f}")
    
    print(f"\nBy Model:")
    for model, data in sorted(stats['by_model'].items()):
        print(f"  {model}:")
        print(f"    Calls: {data['calls']}")
        print(f"    Tokens: {data['tokens']:,}")
        print(f"    Cost: ${data['cost']:.2f}")
    
    print(f"\nBy WBS:")
    for wbs, data in sorted(stats['by_wbs'].items(), key=lambda x: x[1]['cost'], reverse=True):
        print(f"  {wbs}:")
        print(f"    Calls: {data['calls']}")
        print(f"    Tokens: {data['tokens']:,}")
        print(f"    Cost: ${data['cost']:.2f}")

if __name__ == "__main__":
    stats = analyze_llm_usage(days=7)
    print_report(stats)
```

## CI/CD Cost Tracking

### GitHub Actions Usage

Track in `ops/qa/ci-usage.jsonl`:

```jsonl
{
  "date": "2025-11-18",
  "workflow": "deploy-production",
  "runs": 5,
  "duration_minutes": 125,
  "cost_usd": 2.50,
  "success_rate": 1.0
}
```

### Cost Calculation

GitHub Actions pricing:
- Linux: $0.008/minute
- Windows: $0.016/minute
- macOS: $0.08/minute

Free tier: 2,000 minutes/month for private repos

### Tracking Script

```bash
# ops/qa/scripts/track-ci-usage.sh
#!/bin/bash

# Get CI usage from GitHub API
gh api /repos/rastup/platform/actions/workflows \
  --jq '.workflows[] | {name: .name, id: .id}' \
  > workflows.json

# For each workflow, get runs
while read -r workflow; do
  workflow_id=$(echo $workflow | jq -r '.id')
  workflow_name=$(echo $workflow | jq -r '.name')
  
  # Get runs from last 7 days
  gh api "/repos/rastup/platform/actions/workflows/$workflow_id/runs?per_page=100" \
    --jq '.workflow_runs[] | select(.created_at > "'$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)'") | {
      name: .name,
      status: .status,
      conclusion: .conclusion,
      duration: (.updated_at | fromdateiso8601) - (.created_at | fromdateiso8601)
    }' \
    >> ci-runs.json
done < workflows.json

# Analyze and generate report
python ops/qa/scripts/analyze-ci-usage.py
```

## AWS Cost Tracking

### Cost Allocation Tags

All AWS resources tagged with:
- `Project`: rastup
- `Environment`: dev/staging/production
- `Service`: api/search/database/etc.
- `Owner`: AGENT-1/AGENT-2/AGENT-3/AGENT-4

### Cost Explorer Reports

Monthly reports generated for:
- Total cost by service
- Cost by environment
- Cost by owner
- Cost trends

### Budget Alerts

- **Development**: $500/month
- **Staging**: $1,000/month
- **Production**: $5,000/month

Alerts at 80%, 100%, 120% of budget.

## External Service Costs

### Stripe

- Transaction fees: 2.9% + $0.30
- Tracked in Stripe dashboard
- Monthly export to `ops/qa/stripe-costs.csv`

### Twilio

- SMS: $0.0079/message
- Voice: $0.0140/minute
- Tracked in Twilio console
- Monthly export to `ops/qa/twilio-costs.csv`

### SendGrid

- Email: $0.00095/email (after free tier)
- Tracked in SendGrid dashboard
- Monthly export to `ops/qa/sendgrid-costs.csv`

## Reporting

### Weekly Cost Report

```bash
# Generate weekly cost report
npm run qa:cost-report -- --period=week

# Output:
# Cost Report - Week of 2025-11-18
# ================================
# 
# LLM Usage:
#   Total Calls: 150
#   Total Tokens: 2.5M
#   Total Cost: $125.00
#   By Agent:
#     AGENT-1: $30.00
#     AGENT-2: $45.00
#     AGENT-3: $25.00
#     AGENT-4: $25.00
# 
# CI/CD:
#   Total Runs: 50
#   Total Minutes: 500
#   Total Cost: $4.00
# 
# AWS:
#   Total Cost: $1,200.00
#   By Service:
#     EC2/ECS: $400.00
#     RDS: $300.00
#     S3: $100.00
#     Other: $400.00
# 
# External Services:
#   Stripe: $50.00
#   Twilio: $20.00
#   SendGrid: $10.00
# 
# Grand Total: $1,409.00
```

### Monthly Cost Review

- Review all costs
- Identify optimization opportunities
- Update budgets if needed
- Report to leadership

## Cost Optimization

### LLM Optimization

- Use cheaper models when possible (GPT-3.5 vs GPT-4)
- Cache common responses
- Optimize prompts to reduce tokens
- Batch requests when possible

### CI/CD Optimization

- Cache dependencies
- Parallelize jobs
- Skip unnecessary runs
- Use self-hosted runners for heavy workloads

### AWS Optimization

- Right-size instances
- Use reserved instances for steady-state workloads
- Enable auto-scaling
- Delete unused resources
- Use S3 lifecycle policies

## References

- Model Decisions: `ops/model-decisions.jsonl`
- CI Usage: `ops/qa/ci-usage.jsonl`
- Cost Reports: `ops/qa/cost-reports/`
- AWS Cost Explorer: https://console.aws.amazon.com/cost-management/

---

**Review Cadence**: Monthly
