import { redirect } from 'next/navigation';

/** Production lives in ERP Manufacturing (plan 022). Old links land there. */
export default function Page() {
  redirect('/erp/manufacturing');
}
