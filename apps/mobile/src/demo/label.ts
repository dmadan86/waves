/**
 * The demo group's display name. A leaf module so `data/types` can read it
 * without importing `@/i18n` (which drags React into every pure data test);
 * `i18n` pushes the localized name in whenever the language is chosen.
 */
let demoGroupName = 'Demo group';

export function setDemoGroupName(name: string): void {
  demoGroupName = name;
}

export function getDemoGroupName(): string {
  return demoGroupName;
}
