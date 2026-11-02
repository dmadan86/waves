import { Platform } from 'react-native';

/**
 * The one switch for company features. Off on iPhone for the App Store release ("hide company for
 * app store"); Android is unchanged. To ship companies on iOS, make this `true` (see the PR).
 */
export const COMPANIES_ENABLED: boolean = Platform.OS !== 'ios';

/** What an iPhone user sees instead of joining a company. */
export const COMPANIES_SOON_MESSAGE =
  'Companies are coming soon on iPhone. Use the Android app for now.';

export { isCompanyRoute, visibleGroups } from './companiesGate';
