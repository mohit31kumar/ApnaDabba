"use client";

import { useState, useEffect } from "react";
import { api } from "@/services/api";

interface Delivery {
  id: string;
  delivery_date: string;
  slot: string;
  status: string;
  subscription_id: string;
}

export default function DriverDashboardPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchDeliveries = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      
      const response = await api.get<{ success: boolean; data: Delivery[] }>(
        `/api/v1/deliveries/driver/assigned?date=${today}`
      );
      
      if (response.data && response.data.success) {
        setDeliveries(response.data.data || []);
      } else {
        throw new Error("Invalid response format from server");
      }
    } catch (err: any) {
      setError(
        err.response?.data?.message || err.message || "Failed to fetch deliveries."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
  }, []);

  const handleMarkDelivered = async (id: string) => {
    setUpdatingId(id);
    try {
      await api.post(`/api/v1/deliveries/${id}/mark-delivered`);
      await fetchDeliveries();
    } catch (err: any) {
      alert(
        err.response?.data?.message || err.message || "Failed to mark as delivered."
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Driver Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Today's Assigned Deliveries
        </p>
      </header>

      {/* LOADING STATE */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-gray-500 font-medium">Loading deliveries...</p>
        </div>
      )}

      {/* ERROR STATE */}
      {!isLoading && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchDeliveries}
            className="px-4 py-2 bg-red-100 text-red-700 font-semibold rounded hover:bg-red-200 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* EMPTY STATE */}
      {!isLoading && !error && deliveries.length === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500 font-medium text-lg">
            No Deliveries Assigned
          </p>
          <p className="text-gray-400 text-sm mt-1">
            You have no pending deliveries for today.
          </p>
        </div>
      )}

      {/* SUCCESS STATE / LIST */}
      {!isLoading && !error && deliveries.length > 0 && (
        <div className="space-y-4">
          {deliveries.map((delivery) => {
            const isPending = delivery.status === "PENDING";
            const isDelivered = delivery.status === "DELIVERED";
            
            return (
              <div
                key={delivery.id}
                className="bg-white border border-gray-200 shadow-sm rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:shadow-md"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2.5 py-1 rounded-full uppercase">
                      {delivery.slot}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase ${
                        isPending
                          ? "bg-amber-100 text-amber-800"
                          : isDelivered
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {delivery.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-700">
                    Order ID: <span className="font-mono text-gray-500">{delivery.id.slice(0, 8)}</span>
                  </p>
                </div>

                <div className="w-full sm:w-auto mt-2 sm:mt-0">
                  <button
                    onClick={() => handleMarkDelivered(delivery.id)}
                    disabled={!isPending || updatingId === delivery.id}
                    className={`w-full sm:w-auto px-5 py-2.5 rounded-md font-semibold text-sm transition-colors flex justify-center items-center ${
                      isDelivered
                        ? "bg-green-50 text-green-700 cursor-not-allowed border border-green-200"
                        : !isPending
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm active:transform active:scale-95"
                    }`}
                  >
                    {updatingId === delivery.id ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Updating...
                      </>
                    ) : isDelivered ? (
                      "Delivered ✓"
                    ) : (
                      "Mark Delivered"
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}