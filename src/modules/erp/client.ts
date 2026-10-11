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
  const cfg = config();
  return {
    baseUrl: cfg.ERPNEXT_URL?.trim().replace(/\/+$/, '') || undefined,
    apiKey: cfg.ERPNEXT_API_KEY?.trim() || undefined,
    apiSecret: cfg.ERPNEXT_API_SECRET?.trim() || undefined,
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

/** First message ERPNext gives for a refused save (`_server_messages`), as plain text. */
function refusalMessage(body: string): string | null {
  try {
    const json = JSON.parse(body) as { _server_messages?: string };
    const messages = JSON.parse(json._server_messages ?? '[]') as string[];
    const first = messages[0] ? (JSON.parse(messages[0]) as { message?: string }).message : undefined;
    const text = first?.replace(/<[^>]*>/g, '').trim();
    return text || null;
  } catch {
    return null;
  }
}

async function erpRequest<T>(
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  notFoundTarget: string,
  body?: Record<string, unknown>,
  resultKey: 'data' | 'message' = 'data',
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
    // 417: ERPNext understood the request and refused it (validation). Say why.
    const refusal = res.status === 417 ? refusalMessage(snippet) : null;
    if (refusal) {
      console.error('[erp] refused', { method, path, message: refusal });
      throw new DomainError(`ERP refused this: ${refusal}`);
    }
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
    const json = (await res.json()) as Partial<Record<'data' | 'message', T>>;
    const result = json?.[resultKey];
    // A method that returns nothing answers `{}`; a resource call must carry `data`.
    if (result === undefined && resultKey === 'data') {
      console.error('[erp] unexpected response payload', { method, path });
      throw new DomainError(ERP_UNAVAILABLE_MESSAGE);
    }
    return result as T;
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

export async function erpInsert<T = Record<string, unknown>>(
  doctype: string,
  doc: Record<string, unknown>,
): Promise<T> {
  return erpRequest<T>('POST', `/api/resource/${encodeURIComponent(doctype)}`, doctype, doc);
}

/** Calls a whitelisted ERPNext method (`/api/method/<method>`) and returns its `message`. */
export async function erpCall<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return erpRequest<T>('POST', `/api/method/${method}`, method, args, 'message');
}
