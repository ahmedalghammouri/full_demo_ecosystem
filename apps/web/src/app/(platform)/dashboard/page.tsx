import { redirect } from 'next/navigation';

// The former "Home" dashboard was fully superseded by the Command Center.
// Keep this route as a permanent redirect so existing links/bookmarks still work.
export default function DashboardPage() {
  redirect('/command-center');
}
