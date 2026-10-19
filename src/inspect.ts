// The inspection: every item driven `runs` times, every run put through its checks.
import type { Config, Item, Part } from './config.js';
import { inspectRun, type Judge } from './checks.js';
import { drive } from './vehicle.js';
import { makeJudge } from './judge.js';
import type { Certificate } from './cert.js';

export interface RunResult { pass: boolean; reason?: string; ms: number; costUsd?: number; judged: boolean }

export interface ItemResult {
  id: string;
  part: Exclude<Part, 'emissions'>;
  description?: string;
  checks: number;
  runs: RunResult[];
  rate: number;          // pass rate this inspection
  need: number;          // threshold
  was?: number;          // pass rate on the last certificate
  drifted: boolean;      // fell more than `drift` below the certificate
  pass: boolean;
  note?: string;         // the most common failure, or why it failed overall
}

export interface Emissions {
  avgMs: number;
  p95Ms: number;
  costPer100?: number;
  judgeCalls: number;
  judgeSaved: number;
  over: string[];        // budgets exceeded, in words
}

export interface Inspection {
  vehicle: string;
  model?: string;
  judge?: string;
  commit?: string;
  at: string;
  runs: number;
  drift: number;
  items: ItemResult[];
  emissions: Emissions;
  lastCert?: { at: string; commit?: string };
  pass: boolean;
}

export interface Progress { (id: string, run: RunResult): void }

export async function inspect(cfg: Config, opts: { cert?: Certificate; judge?: Judge; only?: string[]; onRun?: Progress; commit?: string } = {}): Promise<Inspection> {
  const judge = opts.judge ?? (cfg.judge ? makeJudge(cfg.judge) : undefined);
  const items = opts.only?.length ? cfg.items.filter((i) => opts.only!.includes(i.id)) : cfg.items;
  let judgeSaved = 0, judgeCalls = 0;

  // One flat queue of (item, run) jobs so a slow item doesn't hold up the rest.
  const jobs = items.flatMap((it) => Array.from({ length: it.runs ?? cfg.runs }, () => it));
  const results = new Map<string, RunResult[]>(items.map((i) => [i.id, []]));
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const it: Item = jobs[next++];
      const d = await drive(cfg.vehicle, it.input, cfg.dir);
      const o = await inspectRun(it.checks, d, cfg.dir, it.input, judge);
      judgeSaved += o.judgeSkipped;
      if (o.judged) judgeCalls++;
      const r: RunResult = { pass: o.pass, reason: o.reason, ms: d.ms, costUsd: d.costUsd, judged: o.judged };
      results.get(it.id)!.push(r);
      opts.onRun?.(it.id, r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, jobs.length) }, worker));

  const itemResults = items.map((it) => grade(it, results.get(it.id)!, cfg, opts.cert));
  const emissions = measure([...results.values()].flat(), cfg, judgeCalls, judgeSaved);
  return {
    vehicle: cfg.vehicle.name,
    model: cfg.vehicle.model,
    judge: cfg.judge ? `${cfg.judge.provider}/${cfg.judge.model}` : undefined,
    commit: opts.commit,
    at: new Date().toISOString(),
    runs: cfg.runs,
    drift: cfg.drift,
    items: itemResults,
    emissions,
    lastCert: opts.cert ? { at: opts.cert.issued, commit: opts.cert.commit } : undefined,
    pass: itemResults.every((i) => i.pass) && emissions.over.length === 0,
  };
}

export function grade(it: Item, runs: RunResult[], cfg: Pick<Config, 'pass_rate' | 'drift'>, cert?: Certificate): ItemResult {
  const passed = runs.filter((r) => r.pass).length;
  const rate = runs.length ? passed / runs.length : 0;
  const need = it.pass_rate ?? cfg.pass_rate;
  const was = cert?.items[it.id];
  // a hair of tolerance so 0.8 - 0.6 isn't read as 0.20000000000000007
  const drifted = was !== undefined && was - rate > cfg.drift + 1e-9;
  const pass = rate + 1e-9 >= need && !drifted;
  return { id: it.id, part: it.part, description: it.description, checks: it.checks.length, runs, rate, need, was, drifted, pass, note: commonFailure(runs) };
}

// Judge and vehicle failures are worded differently every run, so they group by kind;
// deterministic failures group by their exact reason.
const kind = (reason: string) => (/^(judge|vehicle):/.test(reason) ? reason.split(':')[0] : reason);

function commonFailure(runs: RunResult[]): string | undefined {
  const groups = new Map<string, number[]>();
  runs.forEach((r, i) => {
    if (r.pass || !r.reason) return;
    const k = kind(r.reason);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const top = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!top) return undefined;
  const which = top.map((i) => i + 1);
  const label = which.length === runs.length && runs.length > 1 ? 'every run' : `run${which.length > 1 ? 's' : ''} ${which.join(', ')}`;
  return `${label}: ${runs[top[0]].reason}`;
}

export function measure(runs: RunResult[], cfg: Pick<Config, 'emissions'>, judgeCalls: number, judgeSaved: number): Emissions {
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  const avgMs = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0;
  const p95Ms = ms.length ? ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)] : 0;
  const costed = runs.filter((r) => r.costUsd !== undefined);
  const costPer100 = costed.length ? (costed.reduce((a, r) => a + r.costUsd!, 0) / costed.length) * 100 : undefined;
  const b = cfg.emissions ?? {};
  const over: string[] = [];
  if (b.avg_ms && avgMs > b.avg_ms) over.push(`average ${fmtMs(avgMs)} over the ${fmtMs(b.avg_ms)} limit`);
  if (b.p95_ms && p95Ms > b.p95_ms) over.push(`p95 ${fmtMs(p95Ms)} over the ${fmtMs(b.p95_ms)} limit`);
  if (b.cost_per_100 && costPer100 !== undefined && costPer100 > b.cost_per_100)
    over.push(`$${costPer100.toFixed(2)} per 100 runs over the $${b.cost_per_100.toFixed(2)} limit`);
  return { avgMs, p95Ms, costPer100, judgeCalls, judgeSaved, over };
}

export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);
export const pct = (r: number) => `${Math.round(r * 100)}%`;
