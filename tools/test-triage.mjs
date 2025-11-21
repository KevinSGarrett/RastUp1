#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Minimal: run node’s test runner and collect JSON events line-by-line
async function runTests() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=json'], {
      stdio: ['ignore', 'pipe', 'inherit']
    });
    const lines = [];
    child.stdout.on('data', (d) => {
      const s = d.toString();
      s.split('\n').forEach(line => line.trim() && lines.push(line.trim()));
    });
    child.on('close', (code) => resolve({ code, lines }));
  });
}

function summarizeEvents(lines) {
  // Each line is a JSON object event from node:test
  const events = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const failures = [];
  for (const e of events) {
    if (e.type === 'test:fail') {
      failures.push({
        name: e.data?.name,
        file: e.data?.file,
        error: e.data?.details?.error?.message || e.data?.details?.error
      });
    }
  }
  const summary = {
    totalEvents: events.length,
    failures
  };
  return summary;
}

async function sendToOrchestrator(summary) {
  // Replace this with your orchestrator endpoint OR inline LLM call.
  // Example: post summary to a webhook your orchestrator listens to.
  const url = process.env.ORCHESTRATOR_WEBHOOK_URL;
  if (!url) return;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'test_failure', payload: summary })
  });
  if (!res.ok) {
    console.error('Orchestrator webhook failed:', res.status, await res.text());
  }
}

async function main() {
  const { code, lines } = await runTests();
  const summary = summarizeEvents(lines);

  // Always print a human-friendly summary to stdout for developers.
  if (summary.failures.length) {
    console.log('\n❌ Test failures:');
    for (const f of summary.failures) {
      console.log(`- ${f.file ?? ''} :: ${f.name}\n  ${f.error}\n`);
    }
  } else {
    console.log('✅ All tests passed.');
  }

  // Notify orchestrator only on failure
  if (code !== 0) {
    await sendToOrchestrator(summary);
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
