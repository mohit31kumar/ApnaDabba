'use client';

import { ProtectedRoute } from '../components/ProtectedRoute';

export const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <div className="flex h-screen bg-gray-100">
        <aside className="w-64 bg-slate-900 text-white p-4">Admin Sidebar</aside>
        <div className="flex-1 flex flex-col">
          <header className="h-16 bg-white shadow-sm flex items-center px-6">Admin Header</header>
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </ProtectedRoute>
  );
};