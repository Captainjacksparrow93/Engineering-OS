import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/core/db/prisma';
import type { Principal } from '@/core/rbac/types';
import { todayInIndia } from '@/core/utils/dates';
import { quotationEml, quotationHtml, type QuotationDoc } from '../domain/quotation-document';
import { getQuote } from './quote.service';

let logoCache: string | null | undefined;

async function logoDataUri(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const svg = await readFile(path.join(process.cwd(), 'public', 'acs-logo.svg'));
    logoCache = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

/** The customer-facing quotation for a quote the principal can see. */
export async function renderQuotation(principal: Principal, quoteId: string) {
  const quote = await getQuote(principal, quoteId);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: principal.companyId } });
  const owner = quote.deal.owner;
  const doc: QuotationDoc = {
    // GSTIN stays off the quotation for now (user decision 2026-10-09); GST itself is shown.
    company: { name: company.name, address: company.address, gstin: null, logoDataUri: await logoDataUri() },
    number: quote.number,
    revision: quote.revision,
    status: quote.status,
    date: quote.sentAt ?? quote.approvedAt ?? todayInIndia(),
    validUntil: quote.validUntil,
    subject: quote.deal.title,
    client: { name: quote.deal.account.name, city: quote.deal.account.city },
    contact: quote.deal.contact ? { name: quote.deal.contact.name, designation: quote.deal.contact.designation } : null,
    showLineItems: quote.showLineItems,
    lines: quote.lines,
    discountPct: quote.discountPct,
    gstPct: quote.gstPct,
    totals: quote.totals,
    terms: quote.terms,
    salesperson: { name: owner.fullName, designation: owner.designation, email: owner.email, phone: owner.phone },
  };
  return { quote, doc, html: quotationHtml(doc) };
}

/** The Outlook draft for an approved or sent quote. */
export async function quotationEmail(principal: Principal, quoteId: string) {
  const { quote, html } = await renderQuotation(principal, quoteId);
  const label = `${quote.number} R${quote.revision}`;
  const contact = quote.deal.contact;
  const company = await prisma.company.findUniqueOrThrow({ where: { id: principal.companyId }, select: { name: true } });
  const eml = quotationEml({
    to: contact?.email ? { name: contact.name, email: contact.email } : null,
    fromName: quote.deal.owner.fullName,
    subject: `Quotation ${label}: ${quote.deal.title} | ${company.name}`,
    html,
    attachmentName: `Quotation-${label.replace(/\s+/g, '-')}.html`,
    greeting: contact ? `Dear ${contact.name},` : 'Dear Sir/Madam,',
  });
  return { quote, eml, filename: `Quotation-${label.replace(/\s+/g, '-')}.eml` };
}
