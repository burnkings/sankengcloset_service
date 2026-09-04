import { z } from 'zod';

const booleanText = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.string().default('info'),
  DATA_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().default('postgres://sankeng:sankeng@localhost:5432/sankeng'),
  JWT_SECRET: z.string().min(32).default('local-development-secret-change-me-now'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),
  STORAGE_DRIVER: z.enum(['local', 'oss']).default('local'),
  UPLOAD_DIR: z.string().default('./var/uploads'),
  OSS_REGION: z.string().default(''),
  OSS_BUCKET: z.string().default(''),
  OSS_ACCESS_KEY_ID: z.string().default(''),
  OSS_ACCESS_KEY_SECRET: z.string().default(''),
  OSS_PUBLIC_BASE_URL: z.string().default(''),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  AI_PROVIDER: z.enum(['safe_mock', 'remote']).default('safe_mock'),
  AI_VISION_API_URL: z.string().default(''),
  AI_VISION_API_KEY: z.string().default(''),
  WECHAT_APP_ID: z.string().default(''),
  WECHAT_APP_SECRET: z.string().default(''),
  TRUST_PROXY: booleanText.default(false),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = schema.parse(source);
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.includes('local-development')) {
    throw new Error('Production JWT_SECRET must be replaced');
  }
  return config;
}
