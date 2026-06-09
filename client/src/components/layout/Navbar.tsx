'use client';

import { useAuthStore } from '@/store/authStore';
import { ThemeToggle } from '../ui/ThemeToggle';

export const Navbar = () => {
  const { user, logout } = useAuthStore();

  return (
    <nav className="bg-white dark:bg-gray-900 shadow dark:shadow-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-blue-600 dark:text-blue-400">Apna Dabba</h1>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          {user && <span className="text-gray-700 dark:text-gray-300">{user.first_name}</span>}
          <button
            onClick={logout}
            className="px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
};
