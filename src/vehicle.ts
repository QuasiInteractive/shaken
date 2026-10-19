// Drives the agent under test: as a command (input on stdin, output on stdout) or over HTTP.
import { spawn } from 'node:child_process';
import type { Vehicle } from './config.js';
import { pick } from './path.js';

export interface Drive {
  output: unknown;       // parsed JSON when the agent printed JSON, otherwise the text
  text: string;          // the output as text, for text checks
  ms: number;
  costUsd?: number;
  error?: string;        // the agent crashed, timed out or returned an HTTP error
}

export function encodeInput(input: unknown): string {
  return typeof input === 'string' ? input : JSON.stringify(input);
}

export function decodeOutput(raw: string, v: Pick<Vehicle, 'cost_path' | 'output_path'>): Pick<Drive, 'output' | 'text' | 'costUsd'> {
  const trimmed = raw.trim();
  let output: unknown = trimmed;
  try { output = JSON.parse(trimmed); } catch { /* plain text agent */ }
  let costUsd: number | undefined;
  if (v.cost_path && output && typeof output === 'object') {
    const c = Number(pick(output, v.cost_path));
    if (Number.isFinite(c)) costUsd = c;
  }
  if (v.output_path && output && typeof output === 'object') output = pick(output, v.output_path);
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return { output, text, costUsd };
}

export async function drive(v: Vehicle, input: unknown, cwd: string): Promise<Drive> {
  const t0 = performance.now();
  try {
    const raw = v.command ? await runCommand(v.command, encodeInput(input), v.timeout_ms, cwd) : await runHttp(v, input);
    return { ...decodeOutput(raw, v), ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { output: undefined, text: '', ms: Math.round(performance.now() - t0), error: (e as Error).message };
  }
}

function runCommand(cmd: string, stdin: string, timeoutMs: number, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exited with code ${code}${err.trim() ? `: ${err.trim().split('\n').slice(-3).join(' | ')}` : ''}`));
    });
    child.stdin.on('error', () => { /* agent closed stdin early; its exit code tells the story */ });
    child.stdin.end(stdin);
  });
}

async function runHttp(v: Vehicle, input: unknown): Promise<string> {
  const res = await fetch(v.http!.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...expandEnv(v.http!.headers ?? {}) },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(v.timeout_ms),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  return body;
}

// Header values like "Bearer ${AGENT_TOKEN}" read from the environment, so secrets stay out of shaken.yml.
export function expandEnv(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, val]) => [k, val.replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] ?? '')]));
}
