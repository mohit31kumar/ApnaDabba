'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { formatApiError } from '../../utils/errorHelper';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError(null);

    // Strict Validation
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(phone)) {
      setError('Please enter a valid 10-digit phone number.');
      return;
    }
    if (!password.trim()) {
      setError('Password is required.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.post('/api/v1/auth/login/password', {
        phone,
        password,
      });

      // [FIX] ISSUE 1: Remove activeSubscriptionId assumption
      const { user, tokens } = response.data.data;
      const role = user.role;

      // [FIX] ISSUE 5: Role Validation
      const allowedRoles = ['ADMIN', 'CUSTOMER', 'DELIVERY_BOY'];
      if (!allowedRoles.includes(role)) {
        setError('Unrecognized user role. Contact support.');
        setIsLoading(false);
        return;
      }

      let resolvedSubscriptionId = null;

    

      // [FIX] ISSUE 1, 2 & 3: Delegate subscription resolution to Customer Dashboard
      // Do not use admin APIs, manual headers, or client-side filtering here.
      
      // Persist global state without activeSubscriptionId
      setAuth(
        user,
        role,
        tokens.access_token,
        tokens.refresh_token,
        null
      );

      // Role-based redirection
      if (role === 'ADMIN') {
        router.replace('/admin');
      } else if (role === 'CUSTOMER') {
        router.replace('/customer');
      } else if (role === 'DELIVERY_BOY') {
        router.replace('/driver');
      }
     } catch (err: unknown) {
      // [FIX] ISSUE 3: Use Error Normalization
      const { message } = formatApiError(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-lg border border-gray-100">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-extrabold text-gray-900">Login</h2>
          <p className="mt-2 text-sm text-gray-600">
            Welcome back to ApnaDabba
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-md font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray">
              Phone Number
            </label>
            <div className="mt-1">
              <input
                id="phone"
                name="phone"
                type="tel"
                maxLength={10}
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} // Restricts to numbers
                className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-black/40 focus:outline-none text-black focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm"
                placeholder="10-digit mobile number"
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray">
              Password
            </label>
            <div className="mt-1">
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-black/40 focus:outline-none text-black focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm"
                placeholder="••••••••"
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Authenticating...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-medium text-amber-600 hover:text-amber-500">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}