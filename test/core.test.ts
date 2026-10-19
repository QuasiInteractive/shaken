import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectRun, runDeterministic, type Judge } from '../src/checks.js';
import { ConfigError, loadConfig, type Check, type Item } from '../src/config.js';
import { grade, measure, type RunResult } from '../src/inspect.js';
import { parseVerdict } from '../src/judge.js';
import { decodeOutput, type Drive } from '../src/vehicle.js';
import { pick } from '../src/path.js';

const drive = (output: unknown, ms = 100): Drive => ({ output, text: typeof output === 'string' ? output : JSON.stringify(output), ms });
const check = (c: Check, out: unknown, ms?: number) => runDeterministic(c, drive(out, ms), '.');
const reply = { category: 'refund', urgent: true, reply: 'Sorry! We will look into it.' };

describe('deterministic checks', () => {
  it('equals compares a path, including objects and booleans', () => {
    expect(check({ equals: { path: 'category', value: 'refund' } }, reply).pass).toBe(true);
    expect(check({ equals: { path: 'urgent', value: false } }, reply)).toEqual({ pass: false, reason: 'urgent = true' });
    expect(check({ equals: { value: 'yes' } }, 'yes').pass).toBe(true);
  });

  it('contains / not_contains look at the whole output or a path, optionally ignoring case', () => {
    expect(check({ contains: 'look into' }, reply).pass).toBe(true);
    expect(check({ contains: { path: 'reply', value: 'sorry' }, ignore_case: true }, reply).pass).toBe(true);
    expect(check({ contains: { path: 'reply', value: 'sorry' } }, reply).pass).toBe(false);
    expect(check({ not_contains: '4111' }, { reply: 'card 4111 noted' })).toEqual({ pass: false, reason: 'said "4111"' });
  });

  it('regex, max_chars and max_ms', () => {
    expect(check({ regex: { path: 'reply', pattern: '^sorry', flags: 'i' } }, reply).pass).toBe(true);
    expect(check({ regex: '^nope' }, reply).pass).toBe(false);
    expect(check({ max_chars: { path: 'reply', value: 10 } }, reply)).toEqual({ pass: false, reason: '28 chars (max 10)' });
    expect(check({ max_ms: 50 }, reply, 80)).toEqual({ pass: false, reason: 'took 80 ms (max 50)' });
  });

  it('schema validates JSON output and refuses plain text', () => {
    const schema = { type: 'object', required: ['category'], properties: { category: { enum: ['refund', 'shipping'] } } };
    expect(check({ schema }, reply).pass).toBe(true);
    expect(check({ schema }, { category: 'other' }).pass).toBe(false);
    expect(check({ schema }, 'not json')).toEqual({ pass: false, reason: 'output is not JSON' });
  });
});

describe('a run', () => {
  const judgeSays = (pass: boolean): Judge & { calls: number } => {
    const j = (async () => { j.calls++; return { pass, reason: pass ? undefined : 'promised a date' }; }) as Judge & { calls: number };
    j.calls = 0;
    return j;
  };

  it('never calls the judge when a cheap check already failed, even if the judge is listed first', async () => {
    const judge = judgeSays(true);
    const o = await inspectRun([{ judge: 'be nice' }, { equals: { path: 'category', value: 'shipping' } }], drive(reply), '.', {}, judge);
    expect(o).toMatchObject({ pass: false, judged: false, judgeSkipped: 1 });
    expect(judge.calls).toBe(0);
  });

  it('calls the judge last and reports its reason', async () => {
    const judge = judgeSays(false);
    const o = await inspectRun([{ equals: { path: 'category', value: 'refund' } }, { judge: 'no dates' }], drive(reply), '.', {}, judge);
    expect(o).toMatchObject({ pass: false, judged: true, reason: 'judge: promised a date' });
    expect(judge.calls).toBe(1);
  });

  it('a vehicle that crashed fails without checks', async () => {
    const o = await inspectRun([{ contains: 'x' }], { ...drive(''), error: 'exited with code 1' }, '.', {});
    expect(o).toMatchObject({ pass: false, reason: 'vehicle: exited with code 1' });
  });
});

describe('grading and drift', () => {
  const item = (over: Partial<Item> = {}): Item => ({ id: 'a', part: 'steering', input: {}, checks: [{ contains: 'x' }], ...over });
  const runs = (pattern: string): RunResult[] => [...pattern].map((c) => ({ pass: c === '●', reason: c === '●' ? undefined : 'judge: nope', ms: 10, judged: true }));
  const cfg = { pass_rate: 0.8, drift: 0.2 };

  it('passes at exactly the threshold', () => {
    expect(grade(item(), runs('●●●●○'), cfg).pass).toBe(true);
    expect(grade(item(), runs('●●●○○'), cfg).pass).toBe(false);
  });

  it('a per-item pass_rate overrides the default', () => {
    expect(grade(item({ pass_rate: 1 }), runs('●●●●○'), cfg).pass).toBe(false);
  });

  it('fails on drift even above the threshold, and not on a drop of exactly the allowance', () => {
    const cert = { vehicle: 'v', issued: '', runs: 5, items: { a: 1 } };
    expect(grade(item({ pass_rate: 0.5 }), runs('●●●○○'), cfg, cert)).toMatchObject({ rate: 0.6, drifted: true, pass: false });
    expect(grade(item({ pass_rate: 0.5 }), runs('●●●●○'), cfg, cert)).toMatchObject({ drifted: false, pass: true });
  });

  it('groups judge failures worded differently into one note', () => {
    expect(grade(item(), runs('○○○○○'), cfg).note).toBe('every run: judge: nope');
    expect(grade(item(), runs('●○●○●'), cfg).note).toBe('runs 2, 4: judge: nope');
  });

  it('emissions budgets', () => {
    const r = [100, 200, 300, 400, 5000].map((ms) => ({ pass: true, ms, judged: false, costUsd: 0.001 }));
    const e = measure(r, { emissions: { avg_ms: 1000, p95_ms: 6000, cost_per_100: 0.05 } }, 0, 0);
    expect(e).toMatchObject({ avgMs: 1200, p95Ms: 5000 });
    expect(e.costPer100).toBeCloseTo(0.1);
    expect(e.over).toEqual(['average 1.20 s over the 1.00 s limit', '$0.10 per 100 runs over the $0.05 limit']);
  });
});

describe('judge answers', () => {
  it('reads PASS/FAIL JSON, even wrapped in prose', () => {
    expect(parseVerdict('{"verdict":"PASS","reason":"ok"}')).toEqual({ pass: true, reason: 'ok' });
    expect(parseVerdict('Sure! {"verdict": "fail", "reason": "dated"} hope that helps')).toEqual({ pass: false, reason: 'dated' });
  });
  it('an unreadable answer is a failure, never a pass', () => {
    expect(parseVerdict('looks fine to me').pass).toBe(false);
    expect(parseVerdict('{"verdict":"MAYBE"}').pass).toBe(false);
  });
});

describe('agent output', () => {
  it('parses JSON, falls back to text, and pulls cost and the answer from paths', () => {
    expect(decodeOutput('hello', {})).toEqual({ output: 'hello', text: 'hello', costUsd: undefined });
    const d = decodeOutput('{"answer":{"category":"refund"},"usage":{"cost_usd":0.002}}', { cost_path: 'usage.cost_usd', output_path: 'answer' });
    expect(d).toEqual({ output: { category: 'refund' }, text: '{"category":"refund"}', costUsd: 0.002 });
  });
  it('paths accept dots and brackets', () => {
    expect(pick({ a: [{ b: 1 }] }, 'a[0].b')).toBe(1);
    expect(pick({ a: [{ b: 1 }] }, 'a.0.b')).toBe(1);
    expect(pick({}, 'x.y')).toBeUndefined();
  });
});

describe('config', () => {
  const write = (yml: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'shaken-'));
    writeFileSync(join(dir, 'shaken.yml'), yml);
    return join(dir, 'shaken.yml');
  };
  const base = `vehicle: { name: v, command: node a.js }\nitems:\n`;

  it('fills defaults', () => {
    const c = loadConfig(write(base + `  - { id: a, input: hi, checks: [ { contains: hi } ] }\n`));
    expect(c).toMatchObject({ runs: 5, pass_rate: 0.8, drift: 0.2, items: [{ part: 'steering' }] });
  });

  it('names the item, not its index, when something is wrong', () => {
    expect(() => loadConfig(write(base + `  - { id: refund-case, input: hi, checks: [ { containz: hi } ] }\n`)))
      .toThrow(/items\["refund-case"\]\.checks\[0\]/);
  });

  it('refuses a judge check without a judge, duplicate ids, and a vehicle with no way to call it', () => {
    expect(() => loadConfig(write(base + `  - { id: a, input: hi, checks: [ { judge: be nice } ] }\n`))).toThrow(/no `judge:` section/);
    expect(() => loadConfig(write(base + `  - { id: a, input: 1, checks: [ { contains: x } ] }\n  - { id: a, input: 2, checks: [ { contains: x } ] }\n`))).toThrow(/two items are called "a"/);
    expect(() => loadConfig(write(`vehicle: { name: v }\nitems:\n  - { id: a, input: 1, checks: [ { contains: x } ] }\n`))).toThrow(ConfigError);
  });

  it('a missing file says how to start', () => {
    expect(() => loadConfig(join(tmpdir(), 'nope', 'shaken.yml'))).toThrow(/npx shaken init/);
  });
});
