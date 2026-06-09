'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { formatApiError } from '../../utils/errorHelper';

interface PlanConfig {
  name: string;
  price_per_meal: number;
  skip_limit: number;
  buffer_days: number;
}

interface SubscriptionWallet {
  balance: number;
  security_deposit_held: number;
}

interface Delivery {
  id: string;
  delivery_date: string;
  slot: string;
  status: string;
}

interface Subscription {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  plan_code_snapshot: string;
  plan_configs: PlanConfig | null;
  delivery_addresses: {
    address_line_1: string;
    city: string;
    pincode: string;
  } | null;
}

interface DashboardData {
  subscription: Subscription | null;
  wallet: SubscriptionWallet | null;
  todayDeliveries: Delivery[];
  upcomingDeliveries: Delivery[];
}

export default function CustomerDashboard() {
  const { user, setActiveSubscriptionId } = useAuthStore();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<{ success: boolean; data: DashboardData }>(
        '/api/v1/customer/dashboard'
      );
      const data = response.data.data;
      setDashboardData(data);
      if (data.subscription?.id) {
        setActiveSubscriptionId(data.subscription.id);
      }
    } catch (err) {
      const { message } = formatApiError(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [setActiveSubscriptionId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const statusStyles: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    BUFFER: 'bg-amber-100 text-amber-800',
    CANCELLED: 'bg-red-100 text-red-800',
    EXPIRED: 'bg-gray-100 text-gray-800',
    PENDING: 'bg-blue-100 text-blue-800',
    DELIVERED: 'bg-green-100 text-green-800',
    SKIPPED: 'bg-gray-100 text-gray-500',
    FAILED: 'bg-red-100 text-red-800',
    BLOCKED_TIFFIN_DEBT: 'bg-red-100 text-red-800',
  };

  const badge = (status: string) => {
    const style = statusStyles[status] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${style}`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="h-8 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="h-5 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 rounded-xl border border-red-100 p-6 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchDashboard}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty State
  if (!dashboardData?.subscription) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Welcome, {user?.first_name || 'User'}</h1>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900">No Active Subscription</h3>
          <p className="mt-2 text-sm text-gray-500">
            You don&apos;t have an active meal plan at the moment.
          </p>
          <button className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700">
            Browse Plans
          </button>
        </div>
      </div>
    );
  }

  const { subscription, wallet, todayDeliveries, upcomingDeliveries } = dashboardData;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* SECTION 1 — Subscription Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">
              {subscription.plan_configs?.name || subscription.plan_code_snapshot || 'Tiffin Plan'}
            </h3>
            {badge(subscription.status)}
          </div>
          <div className="px-6 py-5">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Start Date</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(subscription.start_date)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">End Date</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(subscription.end_date)}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* SECTION 2 — Wallet Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <h3 className="text-lg font-medium text-gray-900">Wallet</h3>
          </div>
          <div className="px-6 py-5">
            {wallet ? (
              <div>
                <p className="text-3xl font-bold text-gray-900">
                  ₹{Number(wallet.balance).toFixed(2)}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Security Deposit: ₹{Number(wallet.security_deposit_held).toFixed(2)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Wallet unavailable</p>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3 — Today's Deliveries */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-medium text-gray-900">Today&apos;s Deliveries</h3>
        </div>
        <div className="px-6 py-5">
          {todayDeliveries.length === 0 ? (
            <p className="text-sm text-gray-500">No deliveries today</p>
          ) : (
            <div className="space-y-3">
              {todayDeliveries.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">{d.slot}</span>
                  </div>
                  {badge(d.status)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 4 — Upcoming Deliveries */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-medium text-gray-900">Upcoming Deliveries</h3>
        </div>
        <div className="px-6 py-5">
          {upcomingDeliveries.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming deliveries</p>
          ) : (
            <div className="space-y-3">
              {upcomingDeliveries.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500 w-24">{formatDate(d.delivery_date)}</span>
                    <span className="text-sm font-medium text-gray-700">{d.slot}</span>
                  </div>
                  {badge(d.status)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
