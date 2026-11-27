/** Keep the originating tab context as shared settings pages are opened. */
export function settingsRoute(path: string, space?: string): string {
  if (space !== 'personal' || path.includes('space=')) return path;
  return `${path}${path.includes('?') ? '&' : '?'}space=personal`;
}

/**
 * A push from one settings page to another keeps the space it was opened in, so the bar
 * does not flip between Groups and Personal as you go deeper. Other routes are untouched.
 */
export function inheritSettingsSpace<T>(href: T, space?: string): T {
  if (space !== 'personal') return href;
  if (typeof href === 'string') {
    return (href.startsWith('/settings') ? settingsRoute(href, space) : href) as T;
  }
  const target = href as { pathname?: string; params?: Record<string, unknown> };
  if (typeof target.pathname !== 'string' || !target.pathname.startsWith('/settings')) return href;
  return { ...target, params: { space, ...target.params } } as T;
}
