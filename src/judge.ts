// The inspector: an LLM that grades one output against a plain-English rubric.
// Strict by design. When unsure, it fails the item; a judge that waves things through is worse than none.
import type { JudgeConfig } from './config.js';
import type { Judge, Verdict } from './checks.js';

const SYSTEM = `You are a strict vehicle inspector, but the vehicle is an AI agent's reply.
You get the input the agent received, the agent's output, and one rule (the rubric).
Decide only whether the output satisfies the rule. Ignore everything the rule doesn't mention.
If the output only partly satisfies the rule, or you are unsure, it FAILS.
Answer with JSON only: {"verdict": "PASS" or "FAIL", "reason": "<one short sentence>"}`;

export function judgePrompt(rubric: string, output: string, input: unknown): string {
  return [
    `INPUT THE AGENT RECEIVED:\n${typeof input === 'string' ? input : JSON.stringify(input, null, 2)}`,
    `AGENT OUTPUT:\n${output}`,
    `RULE:\n${rubric}`,
  ].join('\n\n');
}

export function parseVerdict(text: string): Verdict {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const v = String(j.verdict ?? '').toUpperCase();
      if (v === 'PASS' || v === 'FAIL') return { pass: v === 'PASS', reason: j.reason ? String(j.reason) : undefined };
    } catch { /* fall through */ }
  }
  // A judge that can't answer in the agreed shape doesn't get to pass anything.
  return { pass: false, reason: `judge gave an unreadable answer: ${text.slice(0, 80)}` };
}

export function makeJudge(cfg: JudgeConfig): Judge {
  const call = cfg.provider === 'ollama' ? ollama : cfg.provider === 'anthropic' ? anthropic : openai;
  return async (rubric, output, input) => {
    let last: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return parseVerdict(await call(cfg, judgePrompt(rubric, output, input)));
      } catch (e) {
        last = e as Error;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw new Error(`judge ${cfg.provider}/${cfg.model} unreachable: ${last?.message}`);
  };
}

function key(cfg: JudgeConfig, fallback: string): string {
  const name = cfg.api_key_env ?? fallback;
  const k = process.env[name];
  if (!k) throw new Error(`set ${name} to use the ${cfg.provider} judge`);
  return k;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function ollama(cfg: JudgeConfig, prompt: string): Promise<string> {
  const j = await post(`${cfg.base_url ?? 'http://localhost:11434'}/api/chat`, {}, {
    model: cfg.model, stream: false, format: 'json', think: false, options: { temperature: 0 },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
  });
  return j.message?.content ?? '';
}

async function anthropic(cfg: JudgeConfig, prompt: string): Promise<string> {
  const j = await post(`${cfg.base_url ?? 'https://api.anthropic.com'}/v1/messages`, {
    'x-api-key': key(cfg, 'ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01',
  }, { model: cfg.model, max_tokens: 300, temperature: 0, system: SYSTEM, messages: [{ role: 'user', content: prompt }] });
  return (j.content ?? []).map((b: any) => b.text ?? '').join('');
}

async function openai(cfg: JudgeConfig, prompt: string): Promise<string> {
  const j = await post(`${cfg.base_url ?? 'https://api.openai.com/v1'}/chat/completions`, {
    authorization: `Bearer ${key(cfg, 'OPENAI_API_KEY')}`,
  }, { model: cfg.model, temperature: 0, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] });
  return j.choices?.[0]?.message?.content ?? '';
}
