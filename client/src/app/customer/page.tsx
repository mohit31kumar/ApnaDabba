'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { formatApiError } from '../../utils/errorHelper';

interface Subscription {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  plan_code_snapshot: string;
  plan_configs?: {
    name?: string;
  } | null;
}

export default function CustomerDashboard() {
  const { user, activeSubscriptionId } = useAuthStore();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!activeSubscriptionId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get(`/api/v1/subscriptions/${activeSubscriptionId}`);
      setSubscription(response.data.data.subscription || response.data.data); // Fallback in case backend structure varies
    } catch (err) {
      const { message } = formatApiError(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [activeSubscriptionId]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Empty State (No active subscription ID found in store, OR fetch returned null)
  if (!activeSubscriptionId || !subscription) {
    // Only show empty state if we are not actively erroring (error state handles failures)
    if (error) return null; 

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
            You don't have an active meal plan at the moment.
          </p>
          <button className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700">
            Browse Plans
          </button>
        </div>
      </div>
    );
  }

  // 3. Error State
  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 rounded-xl border border-red-100 p-6 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={fetchSubscription}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200"
          >
            Retry Loading Dashboard
          </button>
        </div>
      </div>
    );
  }

  // 4. Success State
  const statusStyles: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    BUFFER: 'bg-amber-100 text-amber-800',
    CANCELLED: 'bg-red-100 text-red-800',
    EXPIRED: 'bg-gray-100 text-gray-800',
    ON_HOLD: 'bg-blue-100 text-blue-800',
  };

  const currentStatusStyle = subscription.status ? (statusStyles[subscription.status] || 'bg-gray-100 text-gray-800') : 'bg-gray-100 text-gray-800';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">
            {subscription.plan_configs?.name || subscription.plan_code_snapshot || 'Tiffin Plan'}
          </h3>
          <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${currentStatusStyle}`}>
            {subscription.status || 'UNKNOWN'}
          </span>
        </div>
        
        <div className="px-6 py-5">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-6">
            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-gray-500">Start Date</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {subscription?.start_date ? formatDate(subscription.start_date) : 'N/A'}
              </dd>
            </div>
            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-gray-500">End Date</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {subscription?.end_date ? formatDate(subscription.end_date) : 'N/A'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}