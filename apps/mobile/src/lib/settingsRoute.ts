/** Keep the originating tab context as shared settings pages are opened. */
export function settingsRoute(path: string, space?: string): string {
  return space === 'personal' ? `${path}?space=personal` : path;
}
