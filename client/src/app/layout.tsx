'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Navbar } from '../components/layout/Navbar';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // [FIX] ISSUE 1: Ref to track listener attachment
  const isListenerAttached = useRef(false);
  const hideNav = pathname === '/login';

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
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground transition-colors">
        {!hideNav && <Navbar />}
        {children}
      </body>
    </html>
  );
}