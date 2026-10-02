import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '@/core/config';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import { erpGet, erpList, erpUpdate, isErpEnabled } from './client';

describe('ERPNext REST client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test');
    vi.stubEnv('AUTH_SECRET', '0123456789abcdef0123456789abcdef');
    vi.stubEnv('ERPNEXT_URL', 'http://127.0.0.1:8080/');
    vi.stubEnv('ERPNEXT_API_KEY', 'test_api_key');
    vi.stubEnv('ERPNEXT_API_SECRET', 'test_api_secret');
    resetConfigCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  it('reports isErpEnabled() true only when URL, API key, and API secret are all set', () => {
    expect(isErpEnabled()).toBe(true);

    vi.stubEnv('ERPNEXT_API_SECRET', '');
    resetConfigCache();
    expect(isErpEnabled()).toBe(false);

    vi.stubEnv('ERPNEXT_API_SECRET', '   ');
    resetConfigCache();
    expect(isErpEnabled()).toBe(false);
  });

  it('builds token Authorization header and calls GET /api/resource/<doctype>/<name> with 10s timeout', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { name: 'SAL-ORD-2026-00001', customer: 'Acme' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const order = await erpGet<{ name: string; customer: string }>('Sales Order', 'SAL-ORD-2026-00001');
    expect(order).toEqual({ name: 'SAL-ORD-2026-00001', customer: 'Acme' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8080/api/resource/Sales%20Order/SAL-ORD-2026-00001');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('token test_api_key:test_api_secret');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes filters, fields, limit, and orderBy in erpList query parameters', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ name: 'SAL-ORD-2026-00002' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const rows = await erpList<{ name: string }>('Sales Order', {
      fields: ['name', 'customer'],
      filters: [['Sales Order', 'docstatus', '=', 1]],
      limit: 50,
      orderBy: 'creation desc',
    });

    expect(rows).toEqual([{ name: 'SAL-ORD-2026-00002' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('http://127.0.0.1:8080/api/resource/Sales%20Order');
    expect(parsed.searchParams.get('fields')).toBe(JSON.stringify(['name', 'customer']));
    expect(parsed.searchParams.get('filters')).toBe(JSON.stringify([['Sales Order', 'docstatus', '=', 1]]));
    expect(parsed.searchParams.get('limit_page_length')).toBe('50');
    expect(parsed.searchParams.get('order_by')).toBe('creation desc');
    expect((init.headers as Record<string, string>).Authorization).toBe('token test_api_key:test_api_secret');
  });

  it('sends PUT with JSON body and token auth in erpUpdate', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { name: 'SAL-ORD-2026-00001', custom_project_code: 'ACS-0001-1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const updated = await erpUpdate<{ name: string; custom_project_code: string }>(
      'Sales Order',
      'SAL-ORD-2026-00001',
      { custom_project_code: 'ACS-0001-1' },
    );

    expect(updated.custom_project_code).toBe('ACS-0001-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8080/api/resource/Sales%20Order/SAL-ORD-2026-00001');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ custom_project_code: 'ACS-0001-1' }));
    expect((init.headers as Record<string, string>).Authorization).toBe('token test_api_key:test_api_secret');
  });

  it('converts timeout, network, 5xx, and 401/403 failures into the single DomainError without leaking the secret', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 1. TimeoutError / AbortError
    const timeoutErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    fetchMock.mockRejectedValueOnce(timeoutErr);
    await expect(erpGet('Sales Order', 'SAL-ORD-2026-00001')).rejects.toThrowError(
      new DomainError("ERP isn't responding. Try again in a minute."),
    );

    // 2. 502 Bad Gateway
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }));
    await expect(erpList('Sales Order')).rejects.toThrowError(
      new DomainError("ERP isn't responding. Try again in a minute."),
    );

    // 3. 401 / 403 Auth error
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }));
    await expect(erpUpdate('Customer', 'Cust-1', { custom_acs_reference: 'ACS-0001' })).rejects.toThrowError(
      new DomainError("ERP isn't responding. Try again in a minute."),
    );

    // Ensure secret was never logged
    const loggedText = JSON.stringify(errSpy.mock.calls);
    expect(loggedText).not.toContain('test_api_secret');
    expect(loggedText).not.toContain('test_api_key');

    errSpy.mockRestore();
  });

  it('reports HTTP 404 distinctly as NotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    await expect(erpGet('Sales Order', 'SAL-ORD-MISSING')).rejects.toBeInstanceOf(NotFoundError);
  });
});
