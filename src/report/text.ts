// The inspection sheet as terminal text and as Markdown (GitHub job summary / PR comment).
import type { Inspection, ItemResult } from '../inspect.js';
import { fmtMs, pct } from '../inspect.js';

export const PART_INFO = {
  brakes: { jp: 'ブレーキ', en: 'Brakes', what: 'safety' },
  steering: { jp: 'ステアリング', en: 'Steering', what: 'instructions' },
  lights: { jp: '灯火', en: 'Lights', what: 'output shape' },
} as const;
export const PART_ORDER = ['brakes', 'steering', 'lights'] as const;

const dots = (i: ItemResult) => i.runs.map((r) => (r.pass ? '●' : '○')).join('');
const rateLine = (i: ItemResult) =>
  `need ${pct(i.need)}${i.was !== undefined ? ` · was ${pct(i.was)}` : ''}${i.drifted ? ` · ▼${Math.round((i.was! - i.rate) * 100)}` : ''}`;

export function verdictWords(x: Inspection): string {
  const ok = x.items.filter((i) => i.pass).length;
  const drifted = x.items.filter((i) => i.drifted).length;
  const parts = [`${ok} of ${x.items.length} items roadworthy`];
  if (drifted) parts.push(`${drifted} drifted beyond ${pct(x.drift)}`);
  else if (x.lastCert) parts.push(`no drift beyond ${pct(x.drift)}`);
  if (x.emissions.over.length) parts.push('emissions over limit');
  return parts.join(' · ');
}

const C = (code: number) => (s: string) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = C(31), dim = C(2), bold = C(1), green = C(32);

export function terminal(x: Inspection): string {
  const L: string[] = [];
  L.push('', bold(`  車検  エージェント検査票  ·  agent inspection sheet`));
  L.push(dim(`  vehicle ${x.vehicle}${x.model ? ` (${x.model})` : ''} · ${x.runs} runs per item${x.judge ? ` · judge ${x.judge}` : ''}${x.commit ? ` · ${x.commit}` : ''}`));
  for (const p of PART_ORDER) {
    const items = x.items.filter((i) => i.part === p);
    if (!items.length) continue;
    const info = PART_INFO[p];
    L.push('', `  ${bold(info.jp)} ${dim(`${info.en} · ${info.what}`)}  ${dim(`${items.filter((i) => i.pass).length}/${items.length}`)}`);
    const w = Math.max(...items.map((i) => i.id.length));
    for (const i of items) {
      const d = i.runs.map((r) => (r.pass ? '●' : red('○'))).join('');
      const mark = i.pass ? green('合') : red('否');
      L.push(`   ${mark} ${i.id.padEnd(w)}  ${d}  ${(i.pass ? (s: string) => s : red)(pct(i.rate).padStart(4))}  ${dim(rateLine(i))}`);
      if (!i.pass && i.note) L.push(`     ${red(i.note)}`);
    }
  }
  const e = x.emissions;
  L.push('', `  ${bold('排出ガス')} ${dim('Emissions · cost & speed')}`);
  L.push(`     avg ${fmtMs(e.avgMs)} · p95 ${fmtMs(e.p95Ms)}${e.costPer100 !== undefined ? ` · $${e.costPer100.toFixed(2)} per 100 runs` : ''} · judge calls ${e.judgeCalls}, saved ${e.judgeSaved}`);
  for (const o of e.over) L.push(`     ${red(o)}`);
  L.push('');
  L.push(x.pass ? bold(green(`  判定  合格 PASS`)) + dim(`  ${verdictWords(x)}`) : bold(red(`  判定  不合格 FAIL`)) + dim(`  ${verdictWords(x)}`));
  L.push('');
  return L.join('\n');
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function markdown(x: Inspection): string {
  const L: string[] = [];
  L.push(`## 車検 ${x.pass ? '合格 PASS ✅' : '不合格 FAIL ❌'} · \`${x.vehicle}\``, '');
  L.push(`${verdictWords(x)}. ${x.runs} runs per item${x.judge ? `, judged by \`${x.judge}\`` : ''}${x.commit ? `, commit \`${x.commit}\`` : ''}.`, '');
  for (const p of PART_ORDER) {
    const items = x.items.filter((i) => i.part === p);
    if (!items.length) continue;
    const info = PART_INFO[p];
    L.push(`**${info.jp} ${info.en}** · ${info.what}`, '');
    L.push('| | Item | Runs | Rate | Need | Was | Notes |', '|:-:|---|---|--:|--:|--:|---|');
    for (const i of items) {
      L.push(`| ${i.pass ? '合' : '**否**'} | \`${i.id}\` | ${dots(i)} | ${i.pass ? pct(i.rate) : `**${pct(i.rate)}**`} | ${pct(i.need)} | ${i.was !== undefined ? pct(i.was) + (i.drifted ? ' ▼' : '') : '–'} | ${esc(i.pass ? i.description ?? '' : i.note ?? '')} |`);
    }
    L.push('');
  }
  const e = x.emissions;
  L.push(`**排出ガス Emissions** · avg ${fmtMs(e.avgMs)} · p95 ${fmtMs(e.p95Ms)}${e.costPer100 !== undefined ? ` · $${e.costPer100.toFixed(2)} / 100 runs` : ''} · ${e.judgeSaved} judge calls saved by cheap checks`);
  for (const o of e.over) L.push(`- ❌ ${o}`);
  L.push('', `<sub>Inspected by [shaken](https://github.com/QuasiInteractive/shaken) · Elyra Software</sub>`);
  return L.join('\n') + '\n';
}
