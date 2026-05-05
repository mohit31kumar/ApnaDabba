'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // [FIX] ISSUE 1: Ref to track listener attachment
  const isListenerAttached = useRef(false);

  useEffect(() => {
    // Prevent attaching multiple listeners
    if (isListenerAttached.current) return;

    const handleUnauthorized = () => {
      router.replace('/login');
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    isListenerAttached.current = true;

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      isListenerAttached.current = false;
    };
  }, [router]);

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}