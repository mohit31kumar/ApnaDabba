'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, Role } from '../store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: Role[];
}

export const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { isAuthenticated, role } = useAuthStore();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    if (role && !allowedRoles.includes(role)) {
      if (role === 'ADMIN') router.replace('/admin');
      else if (role === 'CUSTOMER') router.replace('/customer');
      else if (role === 'DELIVERY_BOY') router.replace('/driver');
    }
  }, [isAuthenticated, role, allowedRoles, router, isMounted]);

 // [FIX] ISSUE 4: Protected Route UX (Loading State)
  if (!isMounted || (!isAuthenticated && isMounted) || (role && !allowedRoles.includes(role))) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent"></div>
          <p className="mt-4 text-sm text-gray-500 font-medium">Verifying access...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};