'use client';

export function PrintBar({ label, draft }: { label: string; draft: boolean }) {
  return (
    <div className="flex items-center justify-between gap-base border-b border-hairline bg-canvas px-lg py-sm print:hidden">
      <p className="text-body-sm text-muted">{label}{draft ? ' · draft: submit it before it goes out' : ''}</p>
      <div className="flex gap-xs">
        <button type="button" className="btn btn-secondary" onClick={() => window.close()}>Close</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
    </div>
  );
}
