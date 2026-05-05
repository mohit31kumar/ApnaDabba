'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';

export const Navbar = () => {
  const { user, logout } = useAuthStore();

  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-blue-600">Apna Dabba</h1>

        <div className="flex items-center gap-6">
          {user && <span className="text-gray-700">{user.email}</span>}
          <button
            onClick={logout}
            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
};
