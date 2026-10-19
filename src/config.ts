// shaken.yml: the vehicle under test, the judge, and the inspection items.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const PathValue = z.object({ path: z.string().optional(), value: z.unknown() });
const Text = z.union([z.string(), z.object({ path: z.string().optional(), value: z.string() })]);

export const CheckSchema = z.union([
  z.object({ schema: z.union([z.string(), z.record(z.string(), z.unknown())]) }).strict(),
  z.object({ equals: PathValue }).strict(),
  z.object({ contains: Text, ignore_case: z.boolean().optional() }).strict(),
  z.object({ not_contains: Text, ignore_case: z.boolean().optional() }).strict(),
  z.object({
    regex: z.union([z.string(), z.object({ path: z.string().optional(), pattern: z.string(), flags: z.string().optional() })]),
  }).strict(),
  z.object({ max_chars: z.union([z.number().int().positive(), z.object({ path: z.string().optional(), value: z.number().int().positive() })]) }).strict(),
  z.object({ max_ms: z.number().positive() }).strict(),
  z.object({ judge: z.union([z.string(), z.object({ rubric: z.string(), path: z.string().optional() })]) }).strict(),
]);
export type Check = z.infer<typeof CheckSchema>;

export const PARTS = ['brakes', 'steering', 'lights', 'emissions'] as const;
export type Part = (typeof PARTS)[number];

const ItemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.-]+$/, 'ids may only use letters, numbers, - _ and .'),
  part: z.enum(['brakes', 'steering', 'lights']).default('steering'),
  description: z.string().optional(),
  input: z.unknown(),
  checks: z.array(CheckSchema).min(1, 'an item needs at least one check'),
  pass_rate: z.number().min(0).max(1).optional(),
  runs: z.number().int().positive().optional(),
}).strict();
export type Item = z.infer<typeof ItemSchema>;

const VehicleSchema = z.object({
  name: z.string(),
  model: z.string().optional(),
  command: z.string().optional(),
  http: z.object({ url: z.string().url(), headers: z.record(z.string(), z.string()).optional() }).strict().optional(),
  timeout_ms: z.number().positive().default(60_000),
  cost_path: z.string().optional(),
  output_path: z.string().optional(),
}).strict().refine((v) => !!v.command !== !!v.http, 'give the vehicle exactly one of `command` or `http`');
export type Vehicle = z.infer<typeof VehicleSchema>;

const JudgeSchema = z.object({
  provider: z.enum(['ollama', 'anthropic', 'openai']),
  model: z.string(),
  base_url: z.string().url().optional(),
  api_key_env: z.string().optional(),
}).strict();
export type JudgeConfig = z.infer<typeof JudgeSchema>;

const BudgetSchema = z.object({
  avg_ms: z.number().positive().optional(),
  p95_ms: z.number().positive().optional(),
  cost_per_100: z.number().positive().optional(),
}).strict();
export type Budgets = z.infer<typeof BudgetSchema>;

export const ConfigSchema = z.object({
  vehicle: VehicleSchema,
  judge: JudgeSchema.optional(),
  runs: z.number().int().positive().max(100).default(5),
  pass_rate: z.number().min(0).max(1).default(0.8),
  drift: z.number().min(0).max(1).default(0.2),
  concurrency: z.number().int().positive().max(64).default(4),
  emissions: BudgetSchema.optional(),
  certificate: z.string().default('shaken.cert.json'),
  out_dir: z.string().default('.shaken'),
  items: z.array(ItemSchema).min(1, 'add at least one inspection item'),
}).strict();
export type Config = z.infer<typeof ConfigSchema> & { dir: string; file: string };

export class ConfigError extends Error {}

export function loadConfig(file: string): Config {
  const path = resolve(file);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') throw new ConfigError(`No ${file} here. Run \`npx shaken init\` to write an example.`);
    throw new ConfigError(`${file} isn't valid YAML: ${err.message}`);
  }
  const res = ConfigSchema.safeParse(raw);
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  - ${describePath(raw, i.path)}: ${i.message}`);
    throw new ConfigError(`${file} has problems:\n${lines.join('\n')}`);
  }
  const cfg = { ...res.data, dir: dirname(path), file: path };
  const ids = new Set<string>();
  for (const it of cfg.items) {
    if (ids.has(it.id)) throw new ConfigError(`${file}: two items are called "${it.id}". Ids must be unique.`);
    ids.add(it.id);
    if (it.checks.some((c) => 'judge' in c) && !cfg.judge)
      throw new ConfigError(`${file}: item "${it.id}" has a judge check but there's no \`judge:\` section.`);
  }
  return cfg;
}

// items.3.checks.1 -> items["angry-refund"].checks[1], which is what a person can find in the file
function describePath(raw: unknown, path: PropertyKey[]): string {
  let out = '';
  let node: any = raw;
  for (const p of path) {
    if (typeof p === 'number') {
      const id = node?.[p]?.id;
      out += typeof id === 'string' ? `["${id}"]` : `[${p}]`;
    } else out += (out ? '.' : '') + String(p);
    node = node?.[p as any];
  }
  return out || '(top level)';
}
