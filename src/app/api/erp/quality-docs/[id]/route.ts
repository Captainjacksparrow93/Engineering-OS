import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler } from '@/core/http/api';
import { getRevisionFile } from '@/modules/erp/services/quality-doc.service';

/** Opens one controlled-document revision. The service decides who may see it; only PDF, PNG and JPEG are stored. */
export const GET = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const file = await getRevisionFile(principal, id);
  return new NextResponse(new Uint8Array(file.content), {
    headers: { 'Content-Type': file.mimeType, 'Content-Disposition': `inline; filename="${file.fileName}"`, 'Cache-Control': 'private, no-store' },
  });
});
