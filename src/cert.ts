// The certificate: each item's pass rate the last time the vehicle was certified roadworthy.
// It's committed to the repo, so drift is measured against what was last accepted, not against luck.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './config.js';
import type { Inspection } from './inspect.js';

export interface Certificate {
  vehicle: string;
  issued: string;
  commit?: string;
  runs: number;
  items: Record<string, number>;
}

export function certPath(cfg: Config) { return resolve(cfg.dir, cfg.certificate); }

export function readCert(cfg: Config): Certificate | undefined {
  const p = certPath(cfg);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function writeCert(cfg: Config, insp: Inspection): Certificate {
  const cert: Certificate = {
    vehicle: insp.vehicle,
    issued: insp.at,
    commit: insp.commit,
    runs: insp.runs,
    items: Object.fromEntries(insp.items.map((i) => [i.id, Math.round(i.rate * 1000) / 1000])),
  };
  writeFileSync(certPath(cfg), JSON.stringify(cert, null, 2) + '\n');
  return cert;
}

export function currentCommit(cwd: string): string | undefined {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return undefined; }
}
