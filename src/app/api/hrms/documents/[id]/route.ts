import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler } from '@/core/http/api';
import { getDocumentFile } from '@/modules/hrms/services/document.service';

/**
 * Opens one HR document version. The service decides who may see it; the type was checked
 * from the file's own bytes at upload, so only PDF, PNG and JPEG are ever served.
 */
export const GET = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const file = await getDocumentFile(principal, id);
  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${file.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
