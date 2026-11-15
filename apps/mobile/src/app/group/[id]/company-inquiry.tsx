import { useLocalSearchParams } from 'expo-router';

import { InquiryDetail } from '@/components/company/clients/InquiryDetail';

export default function CompanyInquiryScreen() {
  const { id, inquiryId } = useLocalSearchParams<{ id: string; inquiryId?: string }>();
  return <InquiryDetail groupId={id ?? ''} inquiryId={inquiryId ?? ''} />;
}
