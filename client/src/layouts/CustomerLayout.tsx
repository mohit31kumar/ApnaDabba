'use client';

import { ProtectedRoute } from '../components/ProtectedRoute';

export const CustomerLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <div className="flex flex-col h-screen bg-gray-50">
        <header className="h-14 bg-white shadow-sm flex items-center px-4">Tiffin Service</header>
        <main className="flex-1 overflow-auto pb-16">{children}</main>
        <nav className="h-16 bg-white border-t fixed bottom-0 w-full flex justify-around items-center">
          <span>Home</span>
          <span>Schedule</span>
          <span>Wallet</span>
        </nav>
      </div>
    </ProtectedRoute>
  );
};