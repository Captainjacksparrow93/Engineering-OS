import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { printDocument, type PrintDoc } from '@/modules/erp/services/print.service';
import '@/modules/erp/services/print-loaders';
import { formatMoney, formatQty } from '@/modules/erp/domain/money';
import { PrintBar } from './print-bar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Print' };

/** One letterhead for every ERP document, outside the app shell so it prints clean. */
export default async function ErpPrintPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const p = await getPrincipal();
  if (!p) redirect('/login');
  const { kind, id } = await params;
  let doc: PrintDoc;
  try {
    doc = await printDocument(p, kind, id);
  } catch {
    notFound();
  }
  const showMoney = doc.lines.some((l) => l.amount);
  return (
    <div className="min-h-screen bg-surface">
      <PrintBar label={`${doc.title} ${doc.number}`} draft={doc.status === 'DRAFT'} />
      <article className="mx-auto my-lg max-w-[210mm] bg-white p-xl text-[13px] leading-relaxed text-black shadow print:my-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-black/20 pb-base">
          <div>
            <Image src="/acs-logo.svg" alt="" width={140} height={44} className="h-11 w-auto" />
            <p className="mt-xs font-semibold">{doc.company.name}</p>
            {doc.company.address ? <p className="whitespace-pre-line text-black/70">{doc.company.address}</p> : null}
            {doc.company.gstin ? <p className="text-black/70">GSTIN {doc.company.gstin}</p> : null}
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold uppercase tracking-wide">{doc.title}</h1>
            <p className="font-mono">{doc.number}</p>
            {doc.status === 'DRAFT' ? <p className="font-semibold text-red-700">DRAFT</p> : doc.status === 'CANCELLED' ? <p className="font-semibold text-red-700">CANCELLED</p> : null}
          </div>
        </header>
        <section className="mt-base grid grid-cols-2 gap-lg">
          <div>
            <p className="text-[11px] uppercase text-black/60">{doc.partyLabel}</p>
            {doc.party ? (
              <>
                <p className="font-semibold">{doc.party.name}</p>
                {doc.party.address ? <p className="whitespace-pre-line">{doc.party.address}</p> : null}
                <p>{[doc.party.city, doc.party.state].filter(Boolean).join(', ')}</p>
                {doc.party.gstin ? <p>GSTIN {doc.party.gstin}</p> : null}
              </>
            ) : null}
          </div>
          <dl className="justify-self-end text-right">
            {doc.meta.map(([k, v]) => <div key={k}><dt className="inline text-black/60">{k}: </dt><dd className="inline">{v}</dd></div>)}
          </dl>
        </section>
        <table className="mt-lg w-full border-collapse">
          <thead>
            <tr className="border-y border-black/30 text-left text-[11px] uppercase">
              <th className="py-xs">#</th><th>Description</th><th>HSN/SAC</th><th className="text-right">Qty</th>
              {showMoney ? <><th className="text-right">Rate</th><th className="text-right">GST</th><th className="text-right">Amount</th></> : null}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-black/10 align-top">
                <td className="py-xs pr-xs">{i + 1}</td>
                <td className="pr-sm">{l.description}</td>
                <td>{l.hsn ?? ''}</td>
                <td className="text-right whitespace-nowrap">{formatQty(l.qty)} {l.uom}</td>
                {showMoney ? <><td className="text-right whitespace-nowrap">{l.rate ? formatMoney(l.rate) : ''}</td><td className="text-right">{l.gstRate ? `${l.gstRate.toString()}%` : ''}</td><td className="text-right whitespace-nowrap">{l.amount ? formatMoney(l.amount) : ''}</td></> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {doc.totals && showMoney ? (
          <dl className="ml-auto mt-base w-72 space-y-xxs">
            <div className="flex justify-between"><dt>Net total</dt><dd>{formatMoney(doc.totals.netTotal)}</dd></div>
            {!doc.totals.cgst.isZero() ? <div className="flex justify-between"><dt>CGST</dt><dd>{formatMoney(doc.totals.cgst)}</dd></div> : null}
            {!doc.totals.sgst.isZero() ? <div className="flex justify-between"><dt>SGST</dt><dd>{formatMoney(doc.totals.sgst)}</dd></div> : null}
            {!doc.totals.igst.isZero() ? <div className="flex justify-between"><dt>IGST</dt><dd>{formatMoney(doc.totals.igst)}</dd></div> : null}
            <div className="flex justify-between border-t border-black/30 pt-xxs font-semibold"><dt>Grand total</dt><dd>{formatMoney(doc.totals.grandTotal)}</dd></div>
          </dl>
        ) : null}
        {doc.terms ? <section className="mt-lg"><p className="text-[11px] uppercase text-black/60">Terms and conditions</p><p className="whitespace-pre-line">{doc.terms}</p></section> : null}
        <footer className="mt-xxl flex justify-end"><p className="border-t border-black/40 pt-xs">For {doc.company.name}<br /><span className="text-black/60">Authorised signatory</span></p></footer>
      </article>
    </div>
  );
}
