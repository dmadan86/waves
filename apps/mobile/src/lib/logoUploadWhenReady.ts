/**
 * A group made on the create screen reaches the server through the sync queue,
 * so its logo cannot be uploaded until the server knows the group and the
 * caller as its admin. `canUpload` is false until then (and for anyone who may
 * not set a logo), so waiting for it to turn true means we never attempt an
 * upload the server would refuse.
 */
export async function uploadWhenAllowed(
  canUpload: () => Promise<boolean>,
  upload: () => Promise<unknown>,
  {
    tries = 15,
    delayMs = 2000,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = {},
): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    let allowed = false;
    try {
      allowed = await canUpload();
    } catch {
      // offline or not synced yet: try again
    }
    if (allowed) {
      try {
        await upload();
        return true;
      } catch {
        return false;
      }
    }
    await sleep(delayMs);
  }
  return false;
}
