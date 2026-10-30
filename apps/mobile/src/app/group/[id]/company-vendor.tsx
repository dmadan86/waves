import { useLocalSearchParams } from 'expo-router';

import { VendorLedger } from '@/components/company/vendors/VendorLedger';

export default function CompanyVendorScreen() {
  const { id, vendorId } = useLocalSearchParams<{ id: string; vendorId?: string }>();
  return <VendorLedger groupId={id ?? ''} vendorId={vendorId ?? ''} />;
}
