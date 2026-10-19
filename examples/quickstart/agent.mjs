// A rule-based stand-in for an LLM agent, so you can see shaken work in seconds with no model or key.
// Swap `command:` in shaken.yml for your real agent when you're ready.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { message } = JSON.parse(input);
const m = message.toLowerCase();

const category =
  /refund|charged|money back/.test(m) ? 'refund' :
  /parcel|delivery|tracking|arrive/.test(m) ? 'shipping' :
  /password|locked|log ?in|account/.test(m) ? 'account' : 'other';
const urgent = /today|urgent|asap|now/.test(m);
const reply = message.replace(/\b(?:\d[ -]?){13,19}\b/g, '[card removed]').length !== message.length
  ? "Thanks. For your security we never handle card numbers here; please update it in your account settings."
  : `Thanks for getting in touch. Our ${category} team will look into this and get back to you.`;

process.stdout.write(JSON.stringify({ category, urgent, reply }));
