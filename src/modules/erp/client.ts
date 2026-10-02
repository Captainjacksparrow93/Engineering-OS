import { config } from '@/core/config';
import { DomainError, NotFoundError } from '@/core/rbac/errors';

export const ERP_UNAVAILABLE_MESSAGE = "ERP isn't responding. Try again in a minute.";
const ERP_TIMEOUT_MS = 10_000;

interface ErpCredentials {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
}

function readErpConfig(): Partial<ErpCredentials> {
  let url: string | undefined;
  let apiKey: string | undefined;
  let apiSecret: string | undefined;
  try {
    const cfg = config();
    url = cfg.ERPNEXT_URL;
    apiKey = cfg.ERPNEXT_API_KEY;
    apiSecret = cfg.ERPNEXT_API_SECRET;
  } catch {
    url = process.env.ERPNEXT_URL;
    apiKey = process.env.ERPNEXT_API_KEY;
    apiSecret = process.env.ERPNEXT_API_SECRET;
  }
  const cleanUrl = (url || process.env.ERPNEXT_URL || '').trim().replace(/\/+$/, '');
  const cleanKey = (apiKey || process.env.ERPNEXT_API_KEY || '').trim();
  const cleanSecret = (apiSecret || process.env.ERPNEXT_API_SECRET || '').trim();
  return {
    baseUrl: cleanUrl || undefined,
    apiKey: cleanKey || undefined,
    apiSecret: cleanSecret || undefined,
  };
}

export function isErpEnabled(): boolean {
  const { baseUrl, apiKey, apiSecret } = readErpConfig();
  return Boolean(baseUrl && apiKey && apiSecret);
}

function requireErpConfig(): ErpCredentials {
  const { baseUrl, apiKey, apiSecret } = readErpConfig();
  if (!baseUrl || !apiKey || !apiSecret) {
    throw new DomainError(ERP_UNAVAILABLE_MESSAGE);
  }
  return { baseUrl, apiKey, apiSecret };
}

async function erpRequest<T>(
  method: 'GET' | 'PUT',
  path: string,
  notFoundTarget: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { baseUrl, apiKey, apiSecret } = requireErpConfig();
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `token ${apiKey}:${apiSecret}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[erp] network/timeout failure', {
      method,
      path,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    throw new DomainError(ERP_UNAVAILABLE_MESSAGE);
  }

  if (res.status === 404) {
    throw new NotFoundError(`${notFoundTarget} was not found in ERP.`);
  }

  if (!res.ok) {
    const snippet = await res.text().catch(() => '');
    console.error('[erp] HTTP failure', {
      method,
      path,
      status: res.status,
      statusText: res.statusText,
      body: snippet.slice(0, 500),
    });
    throw new DomainError(ERP_UNAVAILABLE_MESSAGE);
  }

  try {
    const json = (await res.json()) as { data?: T };
    if (!json || json.data === undefined) {
      console.error('[erp] unexpected response payload', { method, path });
      throw new DomainError(ERP_UNAVAILABLE_MESSAGE);
    }
    return json.data;
  } catch (err) {
    if (err instanceof DomainError || err instanceof NotFoundError) throw err;
    console.error('[erp] invalid JSON response', {
      method,
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new DomainError(ERP_UNAVAILABLE_MESSAGE);
  }
}

export async function erpGet<T = Record<string, unknown>>(doctype: string, name: string): Promise<T> {
  const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  return erpRequest<T>('GET', path, `${doctype} "${name}"`);
}

export interface ErpListOptions {
  filters?: unknown;
  fields?: string[];
  limit?: number;
  orderBy?: string;
}

export async function erpList<T = Record<string, unknown>>(
  doctype: string,
  options: ErpListOptions = {},
): Promise<T[]> {
  const params = new URLSearchParams();
  if (options.fields && options.fields.length > 0) {
    params.set('fields', JSON.stringify(options.fields));
  }
  if (options.filters !== undefined) {
    params.set('filters', JSON.stringify(options.filters));
  }
  if (options.limit !== undefined) {
    params.set('limit_page_length', String(options.limit));
  }
  if (options.orderBy) {
    params.set('order_by', options.orderBy);
  }
  const qs = params.toString();
  const path = `/api/resource/${encodeURIComponent(doctype)}${qs ? `?${qs}` : ''}`;
  return erpRequest<T[]>('GET', path, doctype);
}

export async function erpUpdate<T = Record<string, unknown>>(
  doctype: string,
  name: string,
  fields: Record<string, unknown>,
): Promise<T> {
  const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  return erpRequest<T>('PUT', path, `${doctype} "${name}"`, fields);
}
