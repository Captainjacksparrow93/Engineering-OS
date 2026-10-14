import { redirect } from 'next/navigation';

/** Maintenance lives in ERP Assets (plan 022). Old links land there. */
export default function Page() {
  redirect('/erp/assets');
}
