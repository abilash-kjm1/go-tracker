import type { Metadata } from 'next';
import { DanglePreview } from '@/components/dev/DanglePreview';

// A temporary page for choosing the hanging shortcut's look. Remove once chosen.
export const metadata: Metadata = { title: 'Pick a dangle' };

export default function DanglePreviewPage() {
  return <DanglePreview />;
}
