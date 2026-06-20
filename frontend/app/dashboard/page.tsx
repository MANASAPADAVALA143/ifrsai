import { redirect } from 'next/navigation';

/** Lease portfolio dashboard lives under IFRS 16. */
export default function DashboardRootPage() {
  redirect('/dashboard/ifrs16');
}
