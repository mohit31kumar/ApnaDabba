'use client';

export default function AdminDashboard() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
      <p className="text-gray-600 mt-2">Kitchen Operations</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Pending Orders
          </h3>
          <p className="text-3xl font-bold text-orange-600 mt-2">0</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            In Preparation
          </h3>
          <p className="text-3xl font-bold text-yellow-600 mt-2">0</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Ready</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">0</p>
        </div>
      </div>
    </div>
  );
}
