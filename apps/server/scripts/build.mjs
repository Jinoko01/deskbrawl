import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts', 'src/app.ts'],
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias: {
    '@deskbrawl/game-core': '../../packages/game-core/src/index.ts',
    '@deskbrawl/protocol': '../../packages/protocol/src/index.ts',
  },
});
