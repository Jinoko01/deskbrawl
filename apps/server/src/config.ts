import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((value) => value !== 'replace-with-at-least-32-random-bytes'),
  PORT: z.coerce.number().int().min(1).max(65535),
  PUBLIC_ORIGIN: z.url(),
  CLIENT_ORIGINS: z.string().min(1),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86400),
  INVITE_TTL_SECONDS: z.coerce.number().int().min(60).max(2592000),
});

export type Config = z.infer<typeof envSchema> & { origins: string[] };

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  const config = parsed.data;
  const origins = config.CLIENT_ORIGINS.split(',').map((origin) =>
    origin.trim(),
  );
  if (
    origins.some(
      (origin) => !/^(https?:\/\/[^/]+|tauri:\/\/localhost)$/.test(origin),
    )
  ) {
    throw new Error('Invalid CLIENT_ORIGINS');
  }
  if (
    env.NODE_ENV === 'production' &&
    !config.PUBLIC_ORIGIN.startsWith('https://')
  ) {
    throw new Error('Production requires HTTPS');
  }
  if (
    !/^https?:/.test(config.PUBLIC_ORIGIN) ||
    new URL(config.PUBLIC_ORIGIN).origin !== config.PUBLIC_ORIGIN
  ) {
    throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin');
  }
  return { ...config, origins };
}

export const CONFIG = Symbol('CONFIG');
