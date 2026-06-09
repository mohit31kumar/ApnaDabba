import { AdminLayout } from '@/layouts/AdminLayout';

export default function RootAdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}