import type { Metadata } from 'next';
import { FavoritesScreen } from '@/components/home/FavoritesScreen';

export const metadata: Metadata = { title: 'Favourites' };

export default function FavoritesPage() {
  return <FavoritesScreen />;
}
