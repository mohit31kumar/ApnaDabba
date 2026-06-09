import { CustomerLayout } from '@/layouts/CustomerLayout';

export default function RootCustomerLayout({ children }: { children: React.ReactNode }) {
  return <CustomerLayout>{children}</CustomerLayout>;
}