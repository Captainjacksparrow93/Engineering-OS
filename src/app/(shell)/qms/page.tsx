import { redirect } from 'next/navigation';

/** Quality lives in ERP Quality (plan 022). Old links land there. */
export default function Page() {
  redirect('/erp/quality');
}
