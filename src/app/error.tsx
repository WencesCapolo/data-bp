'use client';
import { ErrorScreen } from '@/components/ui/ErrorScreen';

export default function RootError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorScreen error={error} retry={unstable_retry} boundary="root" />;
}
