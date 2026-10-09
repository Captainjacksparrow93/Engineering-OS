import { notFound, redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { renderQuotation } from '@/modules/sales/services/quotation.service';
import { PrintBar } from './print-bar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quotation' };

/** The client's copy on the letterhead, outside the app shell so it prints clean. */
export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  const { id } = await params;
  let rendered;
  try {
    rendered = await renderQuotation(principal, id);
  } catch {
    notFound();
  }
  // The renderer escapes every value; the HTML is ours.
  const body = rendered.html.replace(/^[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*$/, '');
  const style = /<style>([\s\S]*?)<\/style>/.exec(rendered.html)?.[1] ?? '';
  return (
    <div className="bg-surface">
      <PrintBar label={`${rendered.quote.number} R${rendered.quote.revision}`} status={rendered.quote.status} />
      <style dangerouslySetInnerHTML={{ __html: style.replace(/body\{/, '.quotation{') }} />
      <div className="quotation" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
