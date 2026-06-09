'use client';

import { ProtectedRoute } from '../components/ProtectedRoute';

export const DeliveryLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ProtectedRoute allowedRoles={['DELIVERY_BOY']}>
      <div className="flex flex-col h-screen bg-gray-50">
        <header className="h-14 bg-amber-500 text-white flex items-center px-4 font-bold">Driver App</header>
        <main className="flex-1 overflow-auto pb-16">{children}</main>
        <nav className="h-16 bg-white border-t fixed bottom-0 w-full flex justify-around items-center">
          <span>Routes</span>
          <span>Profile</span>
        </nav>
      </div>
    </ProtectedRoute>
  );
};