import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler } from '@/core/http/api';
import { DomainError } from '@/core/rbac/errors';
import { markQuoteSent } from '@/modules/sales/services/quote.service';
import { quotationEmail } from '@/modules/sales/services/quotation.service';

/**
 * Downloads the quotation as an Outlook draft (.eml) and records it as sent. POST only, so a
 * link prefetch can never mark a quote sent.
 */
export const POST = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const { quote, eml, filename } = await quotationEmail(principal, id);
  if (quote.status === 'APPROVED') await markQuoteSent(principal, id);
  else if (quote.status !== 'SENT' && quote.status !== 'ACCEPTED') {
    throw new DomainError(quote.status === 'PENDING_APPROVAL' ? 'A Director must approve this quote before it is sent.' : 'Submit the quote before sending it.');
  }
  return new NextResponse(eml, {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
