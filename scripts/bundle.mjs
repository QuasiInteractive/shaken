// Bundles the CLI and its dependencies into action/shaken.mjs, so the GitHub Action runs with no install step.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'action/shaken.mjs',
  banner: { js: "import { createRequire as __shakenRequire } from 'node:module'; const require = __shakenRequire(import.meta.url);" },
  logLevel: 'info',
});
