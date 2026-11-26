/** Keep the originating tab context as shared settings pages are opened. */
export function settingsRoute(path: string, space?: string): string {
  if (space !== 'personal' || path.includes('space=')) return path;
  return `${path}${path.includes('?') ? '&' : '?'}space=personal`;
}
