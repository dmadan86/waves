export async function runRemoveDemo(
  confirm: () => Promise<boolean>,
  onConfirmed: (() => void) | undefined,
  remove: () => Promise<void>,
): Promise<boolean> {
  if (!(await confirm())) return false;
  onConfirmed?.();
  await remove();
  return true;
}
