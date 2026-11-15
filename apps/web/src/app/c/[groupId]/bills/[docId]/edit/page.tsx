'use client';

import { useParams } from 'next/navigation';

import { BillForm } from '../../BillForm';

export default function EditBillPage() {
  const { groupId, docId } = useParams<{ groupId: string; docId: string }>();
  return <BillForm groupId={groupId} docId={docId} />;
}
