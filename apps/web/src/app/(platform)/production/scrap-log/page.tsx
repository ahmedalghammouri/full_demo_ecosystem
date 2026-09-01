import { ScrapLogView } from '@/features/production/scrap-log-view';

export const metadata = { title: 'Scrap Log | Industry360' };

export default function ScrapLogPage() {
  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <ScrapLogView />
    </div>
  );
}
