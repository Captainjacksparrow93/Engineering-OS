import { AgeingReport } from '../ageing';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accounts payable' };

export default function Page() {
  return <AgeingReport kind="PAYABLE" />;
}
