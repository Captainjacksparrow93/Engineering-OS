import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler } from '@/core/http/api';
import { exportCsv } from '@/modules/erp/services/export.service';

/** CSV download of an ERP list or report; the report's own service checks access. */
export const GET = handler(async (request: NextRequest, context: { params: Promise<{ report: string }> }) => {
  const principal = await requirePrincipal();
  const { report } = await context.params;
  const { filename, body } = await exportCsv(principal, report, request.nextUrl.searchParams);
  return new NextResponse(`﻿${body}`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
  });
});
