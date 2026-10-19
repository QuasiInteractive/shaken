// Dotted paths into agent output: "category", "reply.text", "items.0.sku", "items[0].sku".
export function pick(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  let node: any = obj;
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (node === null || node === undefined) return undefined;
    node = node[key];
  }
  return node;
}

export function asText(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}
