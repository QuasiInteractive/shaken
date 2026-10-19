// Inspection checks. Deterministic checks are free and instant, so they always run first;
// the LLM judge only sees output that already passed everything else.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import type { Check } from './config.js';
import type { Drive } from './vehicle.js';
import { asText, pick } from './path.js';

export interface Verdict { pass: boolean; reason?: string }
export type Judge = (rubric: string, output: string, input: unknown) => Promise<Verdict>;

export const isJudge = (c: Check): c is Extract<Check, { judge: unknown }> => 'judge' in c;

export function label(c: Check): string {
  if ('schema' in c) return typeof c.schema === 'string' ? `schema ${c.schema}` : 'schema';
  if ('equals' in c) return `${c.equals.path ?? 'output'} = ${JSON.stringify(c.equals.value)}`;
  if ('contains' in c) return `contains ${JSON.stringify(typeof c.contains === 'string' ? c.contains : c.contains.value)}`;
  if ('not_contains' in c) return `never ${JSON.stringify(typeof c.not_contains === 'string' ? c.not_contains : c.not_contains.value)}`;
  if ('regex' in c) return `matches /${typeof c.regex === 'string' ? c.regex : c.regex.pattern}/`;
  if ('max_chars' in c) return `≤ ${typeof c.max_chars === 'number' ? c.max_chars : c.max_chars.value} chars`;
  if ('max_ms' in c) return `≤ ${c.max_ms} ms`;
  return 'judge';
}

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaCache = new Map<string, ValidateFunction>();

function validator(schema: string | Record<string, unknown>, dir: string): ValidateFunction {
  const key = typeof schema === 'string' ? resolve(dir, schema) : JSON.stringify(schema);
  let v = schemaCache.get(key);
  if (!v) {
    const s = typeof schema === 'string' ? JSON.parse(readFileSync(key, 'utf8')) : schema;
    v = ajv.compile(s);
    schemaCache.set(key, v);
  }
  return v;
}

const short = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function runDeterministic(c: Check, d: Drive, dir: string): Verdict {
  const out = d.output;
  if ('schema' in c) {
    if (typeof out !== 'object' || out === null) return { pass: false, reason: 'output is not JSON' };
    const v = validator(c.schema, dir);
    return v(out) ? { pass: true } : { pass: false, reason: `schema: ${ajv.errorsText(v.errors, { separator: '; ' })}` };
  }
  if ('equals' in c) {
    const got = pick(out, c.equals.path);
    const ok = JSON.stringify(got) === JSON.stringify(c.equals.value);
    return ok ? { pass: true } : { pass: false, reason: `${c.equals.path ?? 'output'} = ${short(JSON.stringify(got) ?? 'nothing')}` };
  }
  if ('contains' in c || 'not_contains' in c) {
    const want = 'contains' in c;
    const spec = want ? (c as any).contains : (c as any).not_contains;
    const needle: string = typeof spec === 'string' ? spec : spec.value;
    let hay = typeof spec === 'string' ? d.text : asText(pick(out, spec.path));
    let n = needle;
    if (c.ignore_case) { hay = hay.toLowerCase(); n = n.toLowerCase(); }
    const found = hay.includes(n);
    if (found === want) return { pass: true };
    return { pass: false, reason: want ? `missing ${JSON.stringify(needle)}` : `said ${JSON.stringify(needle)}` };
  }
  if ('regex' in c) {
    const spec = typeof c.regex === 'string' ? { pattern: c.regex } as { pattern: string; path?: string; flags?: string } : c.regex;
    const text = spec.path ? asText(pick(out, spec.path)) : d.text;
    return new RegExp(spec.pattern, spec.flags).test(text) ? { pass: true } : { pass: false, reason: `no match for /${spec.pattern}/` };
  }
  if ('max_chars' in c) {
    const spec = typeof c.max_chars === 'number' ? { value: c.max_chars } as { value: number; path?: string } : c.max_chars;
    const len = (spec.path ? asText(pick(out, spec.path)) : d.text).length;
    return len <= spec.value ? { pass: true } : { pass: false, reason: `${len} chars (max ${spec.value})` };
  }
  if ('max_ms' in c) return d.ms <= c.max_ms ? { pass: true } : { pass: false, reason: `took ${d.ms} ms (max ${c.max_ms})` };
  throw new Error('judge checks are not deterministic');
}

export interface RunOutcome {
  pass: boolean;
  reason?: string;     // first failure, in plain words
  judged: boolean;     // whether a judge call was spent
  judgeSkipped: number; // judge calls avoided because a cheap check failed first
}

export async function inspectRun(checks: Check[], d: Drive, dir: string, input: unknown, judge?: Judge): Promise<RunOutcome> {
  const judges = checks.filter(isJudge);
  if (d.error) return { pass: false, reason: `vehicle: ${d.error}`, judged: false, judgeSkipped: judges.length };
  for (const c of checks.filter((c) => !isJudge(c))) {
    const v = runDeterministic(c, d, dir);
    if (!v.pass) return { pass: false, reason: v.reason, judged: false, judgeSkipped: judges.length };
  }
  for (const c of judges) {
    const spec = typeof c.judge === 'string' ? { rubric: c.judge } as { rubric: string; path?: string } : c.judge;
    const text = spec.path ? asText(pick(d.output, spec.path)) : d.text;
    const v = await judge!(spec.rubric, text, input);
    if (!v.pass) return { pass: false, reason: `judge: ${v.reason ?? 'failed the rubric'}`, judged: true, judgeSkipped: 0 };
  }
  return { pass: true, judged: judges.length > 0, judgeSkipped: 0 };
}
