import type { Metadata } from 'next';
import { MyTripScreen } from '@/components/trips/MyTripScreen';

export const metadata: Metadata = { title: 'My trip' };

export default function MyTripPage() {
  return <MyTripScreen />;
}
