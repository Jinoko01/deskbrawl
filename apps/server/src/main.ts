import { createApp } from './app';

import { readConfig } from './config';
async function main(): Promise<void> {
  const config = readConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.PORT, '0.0.0.0');
  console.log(`DeskBrawl server listening on port ${config.PORT}`);
}
void main().catch(() => {
  console.error(
    'DeskBrawl server startup failed. Check configuration and database connectivity.',
  );
  process.exitCode = 1;
});
