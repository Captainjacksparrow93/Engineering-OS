'use client';

export function PrintBar({ label, status }: { label: string; status: string }) {
  const draft = status === 'DRAFT' || status === 'PENDING_APPROVAL';
  return (
    <div className="flex items-center justify-between gap-base border-b border-hairline bg-canvas px-lg py-sm print:hidden">
      <p className="text-body-sm text-muted">
        Quotation {label}
        {draft ? ' · draft: approve it before it goes to the client' : ''}
      </p>
      <div className="flex gap-xs">
        <button type="button" className="btn btn-secondary" onClick={() => window.close()}>Close</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
    </div>
  );
}
