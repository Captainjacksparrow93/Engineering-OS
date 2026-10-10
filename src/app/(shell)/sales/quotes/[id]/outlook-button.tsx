'use client';

import { useRouter } from 'next/navigation';

/** Downloads the Outlook draft. The route also marks the quote sent, so refresh shortly after. */
export function OutlookButton({ quoteId, primary }: { quoteId: string; primary: boolean }) {
  const router = useRouter();
  return (
    <form method="post" action={`/api/sales/quotes/${quoteId}/eml`} onSubmit={() => setTimeout(() => router.refresh(), 1500)}>
      <button type="submit" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} title="Downloads a draft email. Open it to send from your Outlook.">
        Email via Outlook
      </button>
    </form>
  );
}
