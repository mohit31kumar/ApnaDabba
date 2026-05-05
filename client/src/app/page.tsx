'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

export default function RootPage() {
  const { isAuthenticated, role } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    if (role === 'ADMIN') router.replace('/admin');
    else if (role === 'CUSTOMER') router.replace('/customer');
    else if (role === 'DELIVERY_BOY') router.replace('/driver');
  }, [isAuthenticated, role, router]);

  // 👇 IMPORTANT: show fallback UI
  return (
    <div style={{ padding: 20 }}>
      Loading...
    </div>
  );
}