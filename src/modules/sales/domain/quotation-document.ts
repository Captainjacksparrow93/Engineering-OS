/**
 * The customer-facing quotation, as one self-contained HTML document (inline CSS only), so the
 * same output serves the print page and the Outlook attachment. Pure: every value is escaped.
 * Cost and margin never appear in it.
 */
import { formatINR, panelTotals, priceFromMargin, round2, type QuoteTotals } from './pricing';

export interface QuotationDoc {
  company: { name: string; address: string | null; gstin: string | null; logoDataUri: string | null };
  number: string;
  revision: number;
  status: string;
  date: Date;
  validUntil: Date;
  subject: string;
  client: { name: string; city: string | null };
  contact: { name: string; designation: string | null } | null;
  showLineItems: boolean;
  lines: Array<{ panel: string; itemCode: string | null; description: string; uom: string; qty: number; unitCost: number; marginPct: number }>;
  discountPct: number;
  gstPct: number;
  totals: QuoteTotals;
  terms: string;
  salesperson: { name: string; designation: string | null; email: string; phone: string | null };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const e = escapeHtml;
const date = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const money = (n: number) => e(formatINR(n));
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const words: string[] = [];
  if (n >= 100) {
    words.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    words.push(TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    words.push(ONES[n]!);
  }
  return words.join(' ');
}

/** Indian numbering: 12,34,56,789.50 → "Twelve Crore Thirty Four Lakh ... Rupees and Fifty Paise Only". */
export function rupeesInWords(amount: number): string {
  const total = Math.round(amount * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7);
  rupees %= 1e7;
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore).replace(/ Rupees Only$/, '') : belowThousand(crore)} Crore`);
  const lakh = Math.floor(rupees / 1e5);
  rupees %= 1e5;
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));
  let words = parts.length ? `${parts.join(' ')} Rupees` : '';
  if (paise) words += `${words ? ' and ' : ''}${belowThousand(paise)} Paise`;
  return `${words} Only`;
}

export function quotationHtml(doc: QuotationDoc): string {
  const draft = doc.status === 'DRAFT' || doc.status === 'PENDING_APPROVAL';
  const panels = panelTotals(doc.lines);
  let sr = 0;
  const body = doc.showLineItems
    ? panels
        .map((p) => {
          const rows = doc.lines
            .filter((l) => l.panel === p.panel)
            .map((l) => {
              sr += 1;
              const unit = priceFromMargin(l.unitCost, l.marginPct);
              return `<tr><td class="c">${sr}</td><td>${e(l.description)}${l.itemCode ? `<div class="muted">${e(l.itemCode)}</div>` : ''}</td><td class="r">${qty(l.qty)}</td><td class="c">${e(l.uom)}</td><td class="r">${money(unit)}</td><td class="r">${money(round2(unit * l.qty))}</td></tr>`;
            })
            .join('');
          return `<tr class="panel"><td colspan="6">${e(p.panel)}</td></tr>${rows}<tr class="sub"><td colspan="5" class="r">${e(p.panel)} total</td><td class="r">${money(p.amount)}</td></tr>`;
        })
        .join('')
    : panels.map((p, i) => `<tr><td class="c">${i + 1}</td><td colspan="4">${e(p.panel)}<div class="muted">Supply as per the agreed bill of materials</div></td><td class="r">${money(p.amount)}</td></tr>`).join('');

  const t = doc.totals;
  const totalRows = [
    ['Subtotal', t.subtotal],
    ...(t.discount > 0 ? [[`Discount (${doc.discountPct}%)`, -t.discount] as [string, number]] : []),
    ...(t.freight > 0 ? [['Freight', t.freight] as [string, number]] : []),
    ['Taxable value', t.taxable],
    [`GST @ ${doc.gstPct}%`, t.gst],
  ] as Array<[string, number]>;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Quotation ${e(doc.number)} R${doc.revision}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:12px;margin:0;padding:24px;background:#fff}
  .sheet{max-width:820px;margin:0 auto;position:relative}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1C3A62;padding-bottom:12px}
  .head img{height:56px}
  .co{text-align:right}.co b{font-size:15px;color:#1C3A62}
  h1{font-size:18px;letter-spacing:2px;color:#1C3A62;margin:18px 0 8px;text-align:center}
  .meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:12px}
  .meta td{padding:2px 8px 2px 0;vertical-align:top}
  table.items{width:100%;border-collapse:collapse;margin-top:8px}
  table.items th{background:#1C3A62;color:#fff;font-weight:600;padding:6px;text-align:left}
  table.items td{border-bottom:1px solid #ddd;padding:5px 6px;vertical-align:top}
  tr.panel td{background:#eef2f7;font-weight:600}
  tr.sub td{font-weight:600}
  .r{text-align:right}.c{text-align:center}.muted{color:#666;font-size:11px}
  table.totals{margin-left:auto;margin-top:10px;border-collapse:collapse;min-width:320px}
  table.totals td{padding:4px 6px}
  table.totals tr.grand td{border-top:2px solid #1C3A62;font-weight:700;font-size:14px}
  .words{margin-top:6px;font-style:italic}
  .terms{white-space:pre-wrap;margin-top:16px;line-height:1.5}
  .sign{margin-top:28px}
  .draft{position:absolute;top:240px;left:0;right:0;text-align:center;font-size:64px;color:rgba(200,0,0,.12);transform:rotate(-20deg);pointer-events:none}
</style></head>
<body><div class="sheet">
${draft ? '<div class="draft">DRAFT — NOT APPROVED</div>' : ''}
<div class="head">
  <div>${doc.company.logoDataUri ? `<img src="${e(doc.company.logoDataUri)}" alt="${e(doc.company.name)}">` : `<b>${e(doc.company.name)}</b>`}</div>
  <div class="co"><b>${e(doc.company.name)}</b>${doc.company.address ? `<div>${e(doc.company.address)}</div>` : ''}${doc.company.gstin ? `<div>GSTIN: ${e(doc.company.gstin)}</div>` : ''}</div>
</div>
<h1>QUOTATION</h1>
<div class="meta">
  <table><tr><td><b>To</b></td><td>${e(doc.client.name)}${doc.client.city ? `<br>${e(doc.client.city)}` : ''}</td></tr>
  ${doc.contact ? `<tr><td><b>Attn.</b></td><td>${e(doc.contact.name)}${doc.contact.designation ? `, ${e(doc.contact.designation)}` : ''}</td></tr>` : ''}
  <tr><td><b>Subject</b></td><td>${e(doc.subject)}</td></tr></table>
  <table><tr><td><b>Quotation no.</b></td><td>${e(doc.number)} R${doc.revision}</td></tr>
  <tr><td><b>Date</b></td><td>${date(doc.date)}</td></tr>
  <tr><td><b>Valid until</b></td><td>${date(doc.validUntil)}</td></tr></table>
</div>
<table class="items"><thead><tr><th class="c">Sr.</th><th>Description</th><th class="r">Qty</th><th class="c">Unit</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
<tbody>${body}</tbody></table>
<table class="totals">${totalRows.map(([label, n]) => `<tr><td>${e(label)}</td><td class="r">${money(n)}</td></tr>`).join('')}
<tr class="grand"><td>Grand total</td><td class="r">${money(t.grandTotal)}</td></tr></table>
<div class="words">${e(rupeesInWords(t.grandTotal))}</div>
${doc.terms.trim() ? `<div class="terms"><b>Terms and conditions</b>\n${e(doc.terms.trim())}</div>` : ''}
<div class="sign">For <b>${e(doc.company.name)}</b><br><br><br>${e(doc.salesperson.name)}${doc.salesperson.designation ? `<br>${e(doc.salesperson.designation)}` : ''}<br>${e(doc.salesperson.email)}${doc.salesperson.phone ? ` · ${e(doc.salesperson.phone)}` : ''}</div>
</div></body></html>`;
}

/**
 * An Outlook-ready draft (.eml with X-Unsent: 1): opening it in Outlook gives a new message to
 * the client, quotation in the body and attached. Sending stays with the salesperson.
 */
export function quotationEml(input: { to: { name: string; email: string } | null; fromName: string; subject: string; html: string; attachmentName: string; greeting: string }): string {
  const boundary = `acs-${Math.random().toString(36).slice(2)}`;
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const header = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
  const intro = `<p>${escapeHtml(input.greeting)}</p><p>Please find our quotation below and attached. We look forward to your order.</p>`;
  return [
    ...(input.to ? [`To: ${header(input.to.name)} <${input.to.email.replace(/[\r\n<>]/g, '')}>`] : []),
    `Subject: ${header(input.subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(input.html.replace('<body><div class="sheet">', `<body>${intro}<div class="sheet">`)),
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8; name="${input.attachmentName}"`,
    `Content-Disposition: attachment; filename="${input.attachmentName}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64(input.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
