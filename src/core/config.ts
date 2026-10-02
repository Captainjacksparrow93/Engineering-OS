/**
 * Central environment access. Reading `process.env` anywhere else is a bug: values are
 * validated once here so a misconfigured deployment fails at boot, not at 2am.
 */
import { z } from 'zod';

const optionalNonEmpty = <T extends z.ZodString>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s.optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
  APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERTEX_AI_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  ERPNEXT_PUBLIC_URL: optionalNonEmpty(z.string().url()),
  ERPNEXT_URL: optionalNonEmpty(z.string().url()),
  ERP_SSO_SECRET: optionalNonEmpty(z.string().min(32)),
  ERPNEXT_API_KEY: optionalNonEmpty(z.string().min(1)),
  ERPNEXT_API_SECRET: optionalNonEmpty(z.string().min(1)),
});

let cached: z.infer<typeof schema> | null = null;

export function config() {
  if (cached && process.env.NODE_ENV !== 'test') return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

