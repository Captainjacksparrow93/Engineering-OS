/**
 * Central environment access. Reading `process.env` anywhere else is a bug: values are
 * validated once here so a misconfigured deployment fails at boot, not at 2am.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
  APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERTEX_AI_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  ERPNEXT_PUBLIC_URL: z.string().url().optional(),
  ERPNEXT_URL: z.string().url().optional(),
  ERP_SSO_SECRET: z.string().min(32).optional(),
});

let cached: z.infer<typeof schema> | null = null;

export function config() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

