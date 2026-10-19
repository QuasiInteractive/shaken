// The paper inspection sheet, with the inspector's hanko.
import type { Inspection, ItemResult } from '../inspect.js';
import { fmtMs, pct } from '../inspect.js';
import { SHEET_CSS } from './sheet-css.js';
import { PART_INFO, PART_ORDER, verdictWords } from './text.js';
import { VERSION } from '../version.js';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

function row(i: ItemResult): string {
  const runs = i.runs.map((r) => (r.pass ? '<span class="p">●</span>' : '<span class="f">○</span>')).join('');
  const was = i.was !== undefined ? ` · was ${pct(i.was)}` : '';
  const drift = i.drifted ? ` <span class="drift">▼${Math.round((i.was! - i.rate) * 100)}</span>` : '';
  const note = i.pass
    ? esc(i.note ? i.note : `${i.checks} check${i.checks === 1 ? '' : 's'}`)
    : esc(i.note ?? 'below the required rate').replace(/^(runs? [\d, ]+: )(.*)$/, '$1<b>$2</b>');
  return `<tr><td class="id">${esc(i.id)}${i.description ? `<small>${esc(i.description)}</small>` : ''}</td>`
    + `<td class="runs">${runs}</td>`
    + `<td class="rate">${pct(i.rate)}<small>need ${pct(i.need)}${was}${drift}</small></td>`
    + `<td class="mark">${i.pass ? '<span class="ok">合</span>' : '<span class="ng">否</span>'}</td>`
    + `<td class="why">${note}</td></tr>`;
}

const COLS = '<colgroup><col class=c1><col class=c2><col class=c3><col class=c4><col class=c5></colgroup>';

export function html(x: Inspection): string {
  const sections = PART_ORDER.map((p, n) => {
    const items = x.items.filter((i) => i.part === p);
    if (!items.length) return '';
    const info = PART_INFO[p];
    const head = n === PART_ORDER.findIndex((q) => x.items.some((i) => i.part === q))
      ? '<thead><tr><th><span>項目</span>Item</th><th><span>結果</span>Runs</th><th style="text-align:right"><span>合格率</span>Rate</th><th style="text-align:center"><span>判定</span></th><th>Notes</th></tr></thead>'
      : '';
    return `<section><div class="part"><span class="jp">${info.jp}</span><span class="en">${info.en} · ${info.what}</span>`
      + `<span class="tally">${items.filter((i) => i.pass).length} / ${items.length}</span></div>`
      + `<table>${COLS}${head}<tbody>${items.map(row).join('')}</tbody></table></section>`;
  }).join('\n');

  const e = x.emissions;
  const emissions = `<section><div class="part"><span class="jp">排出ガス</span><span class="en">Emissions · cost &amp; speed</span>`
    + `<span class="tally"${e.over.length ? ' style="color:var(--red)"' : ''}>${e.over.length ? 'over limit' : 'within limits'}</span></div>`
    + `<div class="emissions">`
    + `<div><div class="k">Avg latency</div><div class="v">${fmtMs(e.avgMs)}</div></div>`
    + `<div><div class="k">p95 latency</div><div class="v">${fmtMs(e.p95Ms)}</div></div>`
    + `<div><div class="k">Cost per 100 runs</div><div class="v">${e.costPer100 !== undefined ? `$${e.costPer100.toFixed(2)}` : '<small>not reported</small>'}</div></div>`
    + `<div><div class="k">Judge calls saved</div><div class="v">${e.judgeSaved} <small>cheap checks failed first</small></div></div>`
    + `</div>${e.over.map((o) => `<p style="color:var(--red);font:500 12px 'IBM Plex Mono';margin:6px 0 0">${esc(o)}</p>`).join('')}</section>`;

  const verdict = x.pass
    ? `<b>判定 VERDICT: 合格 PASS</b> · ${esc(verdictWords(x))}<br/>Certificate valid until the next change to this vehicle.<br/>Issued by shaken · Elyra Software`
    : `<b style="color:var(--red)">判定 VERDICT: 不合格 FAIL</b> · ${esc(verdictWords(x))}<br/>Not roadworthy. This change should not merge.<br/>Issued by shaken · Elyra Software`;
  const hanko = x.pass
    ? '<div class="hanko"><div><div class="big">合格</div><div class="small">PASS</div></div></div>'
    : '<div class="hanko fail"><div><div class="big">不合格</div><div class="small">FAIL</div></div></div>';

  const field = (jp: string, en: string, v: unknown) => `<div class="field"><div class="k"><span>${jp}</span>${en}</div><div class="v">${esc(v ?? '—')}</div></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${x.pass ? '合格' : '不合格'} · ${esc(x.vehicle)} · shaken</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700;900&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>${SHEET_CSS}</style></head>
<body><article class="sheet">
<header><div><div class="form-no">FORM S-1 · AGENT ROADWORTHINESS</div><h1>エージェント検査票<small>AGENT INSPECTION SHEET</small></h1></div>
<div class="brand"><b>車検</b><br/>shaken v${VERSION}</div></header>
<div class="fields">
${field('車名', 'Vehicle', x.vehicle)}${field('検査日', 'Inspected', when(x.at))}${field('検査回数', 'Runs per item', `× ${x.runs}`)}${field('検査員', 'Judge', x.judge ?? 'none')}
${field('型式', 'Model', x.model)}${field('車台番号', 'Commit', x.commit)}${field('前回車検', 'Last certificate', x.lastCert ? `${when(x.lastCert.at).slice(0, 10)}${x.lastCert.commit ? ` · ${x.lastCert.commit}` : ''}` : 'first inspection')}${field('検査項目', 'Items', x.items.length)}
</div>
${sections}
${emissions}
<footer><div class="verdict-line">${verdict}</div>
<div class="sign"><div class="k"><span>検査印</span>Inspector's seal</div>${hanko}</div></footer>
</article></body></html>
`;
}
