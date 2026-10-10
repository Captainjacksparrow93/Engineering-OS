import { describe, it, expect } from 'vitest';
import { quoteTotals } from './pricing';
import { quotationEml, quotationHtml, rupeesInWords, type QuotationDoc } from './quotation-document';

const lines = [
  { panel: 'PLC Panel', itemCode: 'CPU-1', description: 'CPU <1214C> & I/O', uom: 'Nos', qty: 2, unitCost: 80, marginPct: 20 },
  { panel: 'MCC', itemCode: null, description: 'Enclosure', uom: 'Set', qty: 1, unitCost: 300, marginPct: 25 },
];
const doc = (over: Partial<QuotationDoc> = {}): QuotationDoc => ({
  company: { name: 'ACS Engitech Pvt Ltd', address: null, gstin: null, logoDataUri: null },
  number: 'Q-2026-0001',
  revision: 2,
  status: 'APPROVED',
  date: new Date('2026-10-09T00:00:00Z'),
  validUntil: new Date('2026-11-08T00:00:00Z'),
  subject: 'MCC & PLC panels',
  client: { name: 'Acme "Pharma"', city: 'Ahmedabad' },
  contact: { name: 'R. Shah', designation: 'Purchase Manager' },
  showLineItems: true,
  lines,
  discountPct: 5,
  gstPct: 18,
  totals: quoteTotals(lines, { discountPct: 5, freight: 0, gstPct: 18 }),
  terms: '1. Ex-works.',
  salesperson: { name: 'Test Seller', designation: 'Sales Engineer', email: 'seller@example.test', phone: null },
  ...over,
});

describe('rupeesInWords', () => {
  it('uses the Indian system', () => {
    expect(rupeesInWords(0)).toBe('Zero Rupees Only');
    expect(rupeesInWords(1234567.5)).toBe('Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees and Fifty Paise Only');
    expect(rupeesInWords(25_00_00_000)).toBe('Twenty Five Crore Rupees Only');
  });
});

describe('quotationHtml', () => {
  it('escapes client text and never shows cost or margin', () => {
    const html = quotationHtml(doc());
    expect(html).toContain('CPU &lt;1214C&gt; &amp; I/O');
    expect(html).toContain('Acme &quot;Pharma&quot;');
    expect(html).not.toContain('<1214C>');
    expect(html).not.toContain('₹80.00');
    expect(html).not.toContain('₹300.00');
    expect(html).toContain('Q-2026-0001 R2');
  });

  it('shows discount, GST and the grand total in words, without GSTIN when there is none', () => {
    const html = quotationHtml(doc());
    expect(html).toContain('Discount (5%)');
    expect(html).toContain('GST @ 18%');
    expect(html).toContain('Only</div>');
    expect(html).not.toContain('GSTIN');
    expect(quotationHtml(doc({ company: { name: 'ACS', address: 'Ahmedabad', gstin: '24ABCDE1234F1Z5', logoDataUri: null } }))).toContain('GSTIN: 24ABCDE1234F1Z5');
  });

  it('can show panels as lump sums and marks drafts', () => {
    const html = quotationHtml(doc({ showLineItems: false, status: 'DRAFT' }));
    expect(html).not.toContain('CPU-1');
    expect(html).toContain('Supply as per the agreed bill of materials');
    expect(html).toContain('DRAFT — NOT APPROVED');
  });
});

describe('quotationEml', () => {
  it('builds an unsent Outlook draft with the quotation attached', () => {
    const eml = quotationEml({ to: { name: 'R. Shah', email: 'r@client.test' }, fromName: 'Seller', subject: 'Quotation Q-2026-0001 R2', html: quotationHtml(doc()), attachmentName: 'Quotation-Q-2026-0001-R2.html', greeting: 'Dear R. Shah,' });
    expect(eml).toContain('X-Unsent: 1');
    expect(eml).toContain('<r@client.test>');
    expect(eml).toContain('filename="Quotation-Q-2026-0001-R2.html"');
    expect(eml.split('\r\n').every((l) => l.length <= 998)).toBe(true);
  });
});
