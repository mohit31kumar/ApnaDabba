'use client';

export default function DriverDashboard() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">Driver Dashboard</h1>
      <p className="text-gray-600 mt-2">Manage your deliveries</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Active Deliveries
          </h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">0</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Completed Today
          </h3>
          <p className="text-3xl font-bold text-green-600 mt-2">0</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Today Earnings
          </h3>
          <p className="text-3xl font-bold text-purple-600 mt-2">₹0</p>
        </div>
      </div>
    </div>
  );
}
