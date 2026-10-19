// README badge in the shields.io flat style: "shaken | 合格 7/7" or "shaken | 不合格 6/7".
import type { Inspection } from '../inspect.js';

// Rough text widths at 11px Verdana; CJK glyphs are about a full em.
const width = (s: string) => [...s].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 11 : /[il.,:'|]/.test(ch) ? 3.5 : /[mwMW]/.test(ch) ? 9.5 : 6.6), 0);

export function badge(x: Inspection): string {
  const left = 'shaken';
  const ok = x.items.filter((i) => i.pass).length;
  const right = `${x.pass ? '合格' : '不合格'} ${ok}/${x.items.length}`;
  const lw = Math.round(width(left) + 12), rw = Math.round(width(right) + 12), w = lw + rw;
  const color = x.pass ? '#2f6b45' : '#c8322b';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${left}: ${right}">
<title>${left}: ${right}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#1d1c1a"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,'Noto Sans JP',sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${left}</text><text x="${lw + rw / 2}" y="14">${right}</text>
</g></svg>
`;
}
