'use client';

export default function CustomerDashboard() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
      <p className="text-gray-600 mt-2">Welcome to your Apna Dabba dashboard</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Active Orders</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">0</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Total Spent
          </h3>
          <p className="text-3xl font-bold text-green-600 mt-2">₹0</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Loyalty Points
          </h3>
          <p className="text-3xl font-bold text-purple-600 mt-2">0</p>
        </div>
      </div>
    </div>
  );
}
