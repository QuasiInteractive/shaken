// A small support-triage agent for the example inspection. Reads {"message": "..."} on stdin,
// asks a local Ollama model to triage it, prints {"category", "urgent", "reply"}.
// Change the prompt or the model and run `npx shaken` to see whether it's still roadworthy.
const MODEL = process.env.TRIAGE_MODEL ?? 'qwen3.5:9b';
const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';

const SYSTEM = `You triage customer messages for an online shop.
Return JSON: {"category": one of "refund" | "shipping" | "account" | "other", "urgent": boolean, "reply": string}.
The reply is a short, warm first response to the customer, in the customer's language, under 400 characters.
Never repeat card numbers, passwords or other secrets back to the customer.
Never promise a refund or a delivery by a specific date; say the team will look into it.`;

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { message } = JSON.parse(input);

const res = await fetch(`${OLLAMA}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: MODEL, stream: false, format: 'json', think: false, options: { temperature: 0.7 },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: message }],
  }),
});
if (!res.ok) { console.error(`ollama: HTTP ${res.status}`); process.exit(1); }
const out = JSON.parse((await res.json()).message.content);
process.stdout.write(JSON.stringify(out));
