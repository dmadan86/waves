/**
 * What opening a Company group shows, by role: an owner gets the dashboard, a manager
 * a view of their own team, an employee their own balance and entries. The role comes
 * from the member row the server sent, and the server's row-level security already
 * limits what each role can read, so this is a choice of screen, not a privacy layer.
 */

import { VendorHome } from '@/components/company/vendors/VendorHome';
import { EmployeeHome } from '@/components/company/dashboard/EmployeeHome';
import { ManagerHome } from '@/components/company/dashboard/ManagerHome';
import { OwnerDashboard } from '@/components/company/dashboard/OwnerDashboard';
import { useCompanyEntries } from '@/data/companyEntries';

export function CompanyHome({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  if (view.isVendor) return <VendorHome groupId={groupId} />;
  // A manager who is also an owner sees the owner view (role admin wins).
  if (view.isOwner) return <OwnerDashboard groupId={groupId} />;
  if (view.isManager) return <ManagerHome groupId={groupId} />;
  return <EmployeeHome groupId={groupId} />;
}
