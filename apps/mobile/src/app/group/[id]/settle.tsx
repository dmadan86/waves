import { withScenicGroup } from '@/components/ScenicScope';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Settling up is the top of the group's Balances tab. This route stays only so an
 * old link, a stored deep link or a notification still lands somewhere right.
 */
function SettleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/group/[id]', params: { id: id ?? '', tab: 'balances' } }} />;
}

export default withScenicGroup(SettleScreen);
