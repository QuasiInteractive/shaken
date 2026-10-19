#!/usr/bin/env node
// shaken            inspect the vehicle; exit 1 if it isn't roadworthy
// shaken certify    inspect, and if it passes its thresholds, write a new certificate
// shaken init       write an example shaken.yml
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.js';
import { JudgeError } from './judge.js';
import { currentCommit, readCert, writeCert } from './cert.js';
import { inspect } from './inspect.js';
import { badge } from './report/badge.js';
import { html } from './report/html.js';
import { markdown, terminal } from './report/text.js';
import { EXAMPLE } from './example.js';
import { VERSION } from './version.js';

const HELP = `shaken ${VERSION} · 車検 roadworthy inspections for AI agents

  shaken [inspect]   run every item, print the inspection sheet, exit 1 on 不合格
  shaken certify     inspect and write a new certificate (the baseline drift is measured from)
  shaken init        write an example shaken.yml

options
  -c, --config <file>   config file (default shaken.yml)
  -r, --runs <n>        override runs per item
  -o, --only <id>       inspect only these items (repeatable)
      --no-cert         ignore the certificate (no drift check)
  -h, --help
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c', default: 'shaken.yml' },
      runs: { type: 'string', short: 'r' },
      only: { type: 'string', short: 'o', multiple: true },
      'no-cert': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) { process.stdout.write(HELP); return 0; }
  if (values.version) { process.stdout.write(VERSION + '\n'); return 0; }
  const cmd = positionals[0] ?? 'inspect';

  if (cmd === 'init') {
    const target = resolve(values.config!);
    if (existsSync(target)) { console.error(`${values.config} already exists; not overwriting it.`); return 1; }
    writeFileSync(target, EXAMPLE);
    console.log(`Wrote ${values.config}. Point \`vehicle.command\` at your agent, then run \`npx @quasi-interactive/shaken\`.`);
    return 0;
  }
  if (cmd !== 'inspect' && cmd !== 'certify') { process.stderr.write(HELP); return 2; }

  const cfg = loadConfig(values.config!);
  if (values.runs) cfg.runs = Math.max(1, parseInt(values.runs, 10) || cfg.runs);
  const cert = values['no-cert'] ? undefined : readCert(cfg);
  const total = (values.only?.length ? cfg.items.filter((i) => values.only!.includes(i.id)) : cfg.items)
    .reduce((n, i) => n + (i.runs ?? cfg.runs), 0);

  let done = 0, failed = 0;
  const live = process.stderr.isTTY;
  const x = await inspect(cfg, {
    cert,
    only: values.only,
    commit: currentCommit(cfg.dir),
    onRun: (_, r) => {
      done++; if (!r.pass) failed++;
      if (live) process.stderr.write(`\r  inspecting ${cfg.vehicle.name} · ${done}/${total} runs · ${failed} failed `);
    },
  });
  if (live) process.stderr.write('\r' + ' '.repeat(70) + '\r');

  process.stdout.write(terminal(x));
  const out = resolve(cfg.dir, cfg.out_dir);
  mkdirSync(out, { recursive: true });
  const md = markdown(x);
  writeFileSync(resolve(out, 'sheet.html'), html(x));
  writeFileSync(resolve(out, 'sheet.md'), md);
  writeFileSync(resolve(out, 'badge.svg'), badge(x));
  writeFileSync(resolve(out, 'inspection.json'), JSON.stringify(x, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(`  sheet: ${resolve(out, 'sheet.html')}`);

  if (cmd === 'certify') {
    // A certificate is only issued against the thresholds; drift is ignored so a deliberate
    // change can be accepted as the new normal.
    const roadworthy = x.items.every((i) => i.rate + 1e-9 >= i.need) && x.emissions.over.length === 0;
    if (!roadworthy) { console.log('  No certificate issued: items below their required rate.'); return 1; }
    writeCert(cfg, x);
    console.log(`  Certificate written to ${cfg.certificate}. Commit it so drift is measured from here.`);
    return 0;
  }
  return x.pass ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => {
  console.error(e instanceof ConfigError || e instanceof JudgeError ? `
  ${e.message}` : `shaken: ${(e as Error).stack ?? e}`);
  process.exit(2);
});
