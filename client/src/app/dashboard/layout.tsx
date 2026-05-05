'use client';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <nav className="w-64 bg-gray-900 text-white p-6">
        <h2 className="text-xl font-bold mb-6">Customer Dashboard</h2>
        <ul className="space-y-4">
          <li>
            <a href="/dashboard" className="hover:text-gray-300">
              Home
            </a>
          </li>
          <li>
            <a href="/dashboard/orders" className="hover:text-gray-300">
              My Orders
            </a>
          </li>
          <li>
            <a href="/dashboard/profile" className="hover:text-gray-300">
              Profile
            </a>
          </li>
        </ul>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
