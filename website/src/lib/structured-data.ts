import { absoluteUrl, site, socialLinks } from './site';

/** Stable ids so every page's JSON-LD points at the same two entities. */
export const orgId = `${site.url}#org`;
export const appId = `${site.url}#app`;

export const organizationNode = () => ({
  '@type': 'Organization',
  '@id': orgId,
  name: site.name,
  url: site.url,
  email: site.supportEmail,
  logo: absoluteUrl('/brand/waves-mark.png'),
  sameAs: [site.githubUrl, ...socialLinks.map((l) => l.href)],
});

/** The Waves app, with whichever install URLs are configured. */
export const appNode = (opts: {
  description: string;
  url: string;
  priceCurrency: string;
  inLanguage?: string;
}) => {
  const installUrl = [site.androidUrl, site.iosUrl].filter(Boolean);
  return {
    '@type': 'MobileApplication',
    '@id': appId,
    name: site.name,
    applicationCategory: 'FinanceApplication',
    applicationSubCategory: 'Expense sharing',
    operatingSystem: 'Android, iOS, Web',
    description: opts.description,
    url: opts.url,
    ...(opts.inLanguage ? { inLanguage: opts.inLanguage } : {}),
    publisher: { '@id': orgId },
    ...(installUrl.length
      ? { installUrl: installUrl.length === 1 ? installUrl[0] : installUrl }
      : {}),
    offers: { '@type': 'Offer', price: '0', priceCurrency: opts.priceCurrency },
  };
};
