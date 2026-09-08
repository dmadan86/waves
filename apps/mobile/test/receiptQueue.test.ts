import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  data: new Map<string, string>(),
  getItem: vi.fn(async (key: string) => storage.data.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    storage.data.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    storage.data.delete(key);
  }),
}));

const fs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  failDelete: false,
}));

/** Unique ids per call, so a test can park more than one capture. */
const ids = vi.hoisted(() => ({ n: 0 }));

/** The world outside the queue: the network, R2, and the attach RPC. */
const world = vi.hoisted(() => ({
  online: true,
  put: vi.fn(async (_input: unknown) => 'stored'),
  rpc: vi.fn(async (_name: string, _args: unknown) => ({
    error: null as { message: string } | null,
  })),
  cached: [] as { bucket: string; path: string }[],
  /** Whether a cache write succeeds. False stands in for a full/unwritable cache. */
  cacheWrites: true,
  /** Objects taken back out of the bucket, in order — see the orphan test. */
  removed: [] as { bucket: string; subjectId: string; path: string }[],
  remove: vi.fn(async (bucket: string, subjectId: string, path: string) => {
    world.removed.push({ bucket, subjectId, path });
  }),
}));

class FakeDirectory {
  readonly uri: string;

  constructor(...parts: string[]) {
    this.uri = parts.join('/');
  }

  get exists(): boolean {
    return fs.dirs.has(this.uri);
  }

  create(): void {
    fs.dirs.add(this.uri);
  }

  delete(): void {
    if (fs.failDelete) throw new Error('delete failed');
    fs.dirs.delete(this.uri);
    for (const key of [...fs.files.keys()]) {
      if (key.startsWith(`${this.uri}/`)) fs.files.delete(key);
    }
  }

  list(): FakeFile[] {
    return [...fs.files.keys()]
      .filter((key) => key.startsWith(`${this.uri}/`))
      .map((key) => new FakeFile(key));
  }
}

class FakeFile {
  readonly uri: string;

  constructor(...parts: unknown[]) {
    this.uri = parts
      .map((part) => (part instanceof FakeDirectory ? part.uri : String(part)))
      .join('/');
  }

  get name(): string {
    return this.uri.split('/').pop() ?? this.uri;
  }

  get exists(): boolean {
    return fs.files.has(this.uri);
  }

  write(bytes: Uint8Array): void {
    fs.files.set(this.uri, new Uint8Array(bytes));
  }

  delete(): void {
    if (fs.failDelete) throw new Error('delete failed');
    fs.files.delete(this.uri);
  }

  async base64(): Promise<string> {
    return Buffer.from(fs.files.get(this.uri) ?? new Uint8Array()).toString('base64');
  }
}

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => {
    ids.n += 1;
    return `uuid${ids.n}`;
  }),
}));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(async () => ({
    isConnected: world.online,
    isInternetReachable: world.online,
  })),
}));
vi.mock('expo-file-system', () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { document: 'document-root', cache: 'cache-root' },
}));
vi.mock('@/lib/backend', () => ({
  backend: { rpc: (name: string, args: unknown) => world.rpc(name, args) },
}));
vi.mock('@/lib/storage', () => ({
  putImage: (input: unknown) => world.put(input),
  removeRestrictedImage: (bucket: string, subjectId: string, path: string) =>
    world.remove(bucket, subjectId, path),
}));
const cacheUri = (bucket: string, path: string) => `cache-root/${bucket}/${path}`;
vi.mock('@/lib/storage/imageCache', () => ({
  cacheImageBytes: vi.fn((bucket: string, path: string) => {
    if (!world.cacheWrites) return null;
    world.cached.push({ bucket, path });
    return `cache-root/${bucket}/${path}`;
  }),
  cachedImageUri: vi.fn((bucket: string, path: string) =>
    world.cached.some((item) => item.bucket === bucket && item.path === path)
      ? `cache-root/${bucket}/${path}`
      : null,
  ),
}));
vi.mock('@/lib/transferProgress', () => ({
  endTransfer: vi.fn(),
  setTransferProgress: vi.fn(),
  startTransfer: vi.fn(),
}));

const {
  clearReceiptQueue,
  discardPendingReceipt,
  dropSettledReceipts,
  enqueueReceipt,
  flushReceiptQueue,
  getPendingReceiptsSnapshot,
  listPendingReceipts,
  pendingReceiptUri,
  retryPendingReceipts,
  subscribePendingReceipts,
} = await import('../src/lib/receiptQueue');

const QUEUE_KEY = 'receipt-upload-queue.v1';
const pendingPath = (fileName: string) => `document-root/pending-receipts/${fileName}`;

/** A stored entry, as a previous run of the app would have left it. */
const entryFor = (overrides: Partial<Record<string, unknown>> = {}) => ({
  attachmentId: 'a1',
  expenseId: 'e1',
  groupId: 'g1',
  visibility: 'group' as const,
  storagePath: 'e1/a1.jpg',
  contentType: 'image/jpeg',
  fileName: 'a1.jpg',
  createdAt: '2026-01-01T00:00:00Z',
  attempts: 0,
  lastError: null,
  ...overrides,
});

/** Put one capture on disk exactly as a killed run of the app would have. */
function parkOnDisk(overrides: Partial<Record<string, unknown>> = {}): void {
  const entry = entryFor(overrides);
  storage.data.set(QUEUE_KEY, JSON.stringify([entry]));
  fs.dirs.add('document-root/pending-receipts');
  fs.files.set(pendingPath(entry.fileName), new Uint8Array([1, 2, 3]));
}

async function storedQueue(): Promise<Record<string, unknown>[]> {
  return JSON.parse(storage.data.get(QUEUE_KEY) ?? '[]') as Record<string, unknown>[];
}

beforeEach(() => {
  storage.data.clear();
  storage.getItem.mockClear();
  storage.setItem.mockClear();
  storage.removeItem.mockClear();
  fs.files.clear();
  fs.dirs.clear();
  fs.failDelete = false;
  ids.n = 0;
  world.online = true;
  world.cached = [];
  world.cacheWrites = true;
  world.removed = [];
  world.remove.mockReset();
  world.remove.mockImplementation(async (bucket: string, subjectId: string, path: string) => {
    world.removed.push({ bucket, subjectId, path });
  });
  world.put.mockReset();
  world.put.mockImplementation(async () => 'stored');
  world.rpc.mockReset();
  world.rpc.mockImplementation(async () => ({ error: null }));
});

describe('parking a capture', () => {
  it('writes the bytes down and queues the entry before anything is sent', async () => {
    const entry = await enqueueReceipt({
      expenseId: 'e1',
      groupId: 'g1',
      visibility: 'group',
      base64: Buffer.from([7, 8, 9]).toString('base64'),
      contentType: 'image/jpeg',
    });

    // The photograph exists somewhere other than memory from this moment on —
    // which is the whole reason the queue writes before it uploads.
    expect(fs.files.get(pendingPath(entry.fileName))).toEqual(new Uint8Array([7, 8, 9]));
    expect(await listPendingReceipts('e1')).toHaveLength(1);
    expect(world.put).not.toHaveBeenCalled();
    // And it is on screen straight away, as something waiting rather than sent.
    expect(getPendingReceiptsSnapshot().map((item) => item.status)).toEqual(['queued']);
  });

  it('publishes to subscribers as the queue changes', async () => {
    const seen: number[] = [];
    const unsubscribe = subscribePendingReceipts(() => {
      seen.push(getPendingReceiptsSnapshot().length);
    });

    const entry = await enqueueReceipt({
      expenseId: 'e1',
      groupId: 'g1',
      visibility: 'group',
      base64: Buffer.from([1]).toString('base64'),
      contentType: 'image/jpeg',
    });
    await discardPendingReceipt(entry.attachmentId);
    unsubscribe();

    // A gallery three screens away learns about both without asking.
    expect(seen.at(-1)).toBe(0);
    expect(seen).toContain(1);
    expect(fs.files.has(pendingPath(entry.fileName))).toBe(false);
  });
});

describe('resuming an interrupted upload', () => {
  it('picks up a capture left by a previous run of the app and sends it', async () => {
    parkOnDisk();
    // A cold start: a module with no memory of the run that parked this.
    vi.resetModules();
    const fresh = await import('../src/lib/receiptQueue');
    expect(fresh.getPendingReceiptsSnapshot()).toHaveLength(0);

    expect(await fresh.listPendingReceipts()).toHaveLength(1);
    expect(fresh.getPendingReceiptsSnapshot()[0]?.status).toBe('queued');

    const result = await fresh.flushReceiptQueue();

    expect(world.put).toHaveBeenCalledTimes(1);
    expect(world.rpc).toHaveBeenCalledWith('waves_attach_expense_attachment', {
      p_expense_id: 'e1',
      p_storage_path: 'e1/a1.jpg',
      p_visibility: 'group',
      p_attachment_id: 'a1',
      p_preview: null,
    });
    expect(result.uploadedExpenseIds).toEqual(['e1']);
    // Sent, so the bytes move into the view cache and out of the pending dir.
    expect(world.cached).toEqual([{ bucket: 'expense-attachments', path: 'e1/a1.jpg' }]);
    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(false);
    // The entry itself stays, marked sent — it is what the gallery draws until
    // the real row arrives, and dropping it here is what used to blank the strip.
    expect((await storedQueue()).map((entry) => entry.attachmentId)).toEqual(['a1']);
    expect(fresh.getPendingReceiptsSnapshot()[0]?.status).toBe('sent');
  });

  it('says a capture is sending while it is in the air', async () => {
    parkOnDisk();
    let statusMidUpload: string | undefined;
    world.put.mockImplementation(async () => {
      statusMidUpload = getPendingReceiptsSnapshot()[0]?.status;
      return 'stored';
    });

    await listPendingReceipts();
    await flushReceiptQueue();

    expect(statusMidUpload).toBe('uploading');
  });

  it('leaves everything alone and sends nothing while offline', async () => {
    parkOnDisk();
    world.online = false;

    const result = await flushReceiptQueue();

    expect(world.put).not.toHaveBeenCalled();
    expect(result.uploadedExpenseIds).toEqual([]);
    expect(await storedQueue()).toHaveLength(1);
    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(true);
  });

  it('keeps a capture parked when nothing is due yet', async () => {
    // A failure a moment ago; its backoff has not run out.
    parkOnDisk({
      attempts: 1,
      lastError: 'network request failed',
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await flushReceiptQueue();

    expect(world.put).not.toHaveBeenCalled();
    expect(await storedQueue()).toHaveLength(1);
  });
});

describe('the handover from the queue to the real row', () => {
  it('keeps drawing the same picture while the row is still on its way down', async () => {
    parkOnDisk();
    await listPendingReceipts();
    await flushReceiptQueue();

    // The whole point: after a successful upload there is still something for
    // the gallery to draw. Dropping the entry here left the strip empty for the
    // length of a sync pull — the blank the person actually complained about.
    const [entry] = getPendingReceiptsSnapshot();
    expect(entry?.status).toBe('sent');
    // And it resolves to the very file the real row will resolve to, so the
    // swap when the row lands redraws nothing.
    expect(entry && pendingReceiptUri(entry)).toBe(cacheUri('expense-attachments', 'e1/a1.jpg'));
  });

  it('never sends a settled capture a second time', async () => {
    parkOnDisk();
    await listPendingReceipts();
    await flushReceiptQueue();
    world.put.mockClear();
    world.rpc.mockClear();

    await flushReceiptQueue();

    expect(world.put).not.toHaveBeenCalled();
    expect(world.rpc).not.toHaveBeenCalled();
  });

  it('does not re-send a settled capture even if retry is asked for', async () => {
    parkOnDisk();
    await listPendingReceipts();
    await flushReceiptQueue();
    world.put.mockClear();
    world.rpc.mockClear();

    const result = await retryPendingReceipts(['a1']);

    expect(result.uploadedExpenseIds).toEqual([]);
    expect(world.put).not.toHaveBeenCalled();
    expect(world.rpc).not.toHaveBeenCalled();
    expect(getPendingReceiptsSnapshot()[0]?.status).toBe('sent');
  });

  it('lets go once the gallery has seen the row', async () => {
    parkOnDisk();
    await listPendingReceipts();
    await flushReceiptQueue();

    await dropSettledReceipts(['a1']);

    expect(getPendingReceiptsSnapshot()).toEqual([]);
    expect(await storedQueue()).toEqual([]);
  });

  it('forgets a settled capture whose row never came', async () => {
    // Uploaded a day ago on a device that has not managed a pull since. The
    // gallery would otherwise show a tile for a receipt that may since have
    // been removed from somewhere else.
    parkOnDisk({ sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });

    expect(await listPendingReceipts()).toEqual([]);
  });

  it('keeps the local bytes when the cache write failed, so there is still something to draw', async () => {
    world.cacheWrites = false;
    parkOnDisk();
    await listPendingReceipts();
    await flushReceiptQueue();

    const [entry] = getPendingReceiptsSnapshot();
    expect(entry?.status).toBe('sent');
    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(true);
    expect(entry && pendingReceiptUri(entry)).toBe(pendingPath('a1.jpg'));
  });

  it('carries the stored placeholder up with the receipt', async () => {
    await enqueueReceipt({
      expenseId: 'e1',
      groupId: 'g1',
      visibility: 'group',
      base64: Buffer.from([1]).toString('base64'),
      contentType: 'image/jpeg',
      preview: 'data:image/jpeg;base64,AAAA',
    });

    await flushReceiptQueue();

    expect(world.rpc).toHaveBeenCalledWith(
      'waves_attach_expense_attachment',
      expect.objectContaining({ p_preview: 'data:image/jpeg;base64,AAAA' }),
    );
  });
});

describe('a capture that does not go up', () => {
  it('keeps a transient failure, records it, and backs off before trying again', async () => {
    parkOnDisk();
    world.put.mockRejectedValue(new Error('Network request failed'));

    const first = await flushReceiptQueue();

    expect(first.uploadedExpenseIds).toEqual([]);
    expect(first.hadPermanentFailure).toBe(false);
    const [stored] = await storedQueue();
    expect(stored).toMatchObject({ attempts: 1, permanent: false });
    expect(stored?.lastError).toContain('Network request failed');
    expect(Date.parse(String(stored?.nextAttemptAt))).toBeGreaterThan(Date.now());
    // The bytes are still there — a failed send never costs the photograph.
    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(true);
    expect(getPendingReceiptsSnapshot()[0]?.status).toBe('failed');

    // A second flush straight away respects the backoff rather than hammering.
    await flushReceiptQueue();
    expect(world.put).toHaveBeenCalledTimes(1);
  });

  it('keeps a refusal visible instead of dropping it, and never retries it by itself', async () => {
    parkOnDisk();
    world.rpc.mockResolvedValue({ error: { message: 'ATTACHMENT_CAP reached' } });

    const result = await flushReceiptQueue();

    expect(result.hadPermanentFailure).toBe(true);
    expect(result.capReached).toBe(true);
    const [stored] = await storedQueue();
    expect(stored).toMatchObject({ permanent: true, nextAttemptAt: null });
    // Still on the phone, still on screen: a receipt that vanished with no
    // explanation is indistinguishable from a bug.
    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(true);
    expect(getPendingReceiptsSnapshot()[0]?.status).toBe('failed');

    await flushReceiptQueue();
    expect(world.put).toHaveBeenCalledTimes(1);
  });

  /**
   * The upload and the row that makes it findable are two calls, and the gap
   * between them is the one place a receipt can cost something permanently:
   * bytes accepted by the bucket with nothing in the database pointing at them
   * are invisible to every screen, unreachable by any delete the app offers, and
   * still counted against the group's storage ceiling. The local file is the
   * source of truth and survives, so taking the remote copy back out is free.
   */
  it('takes the uploaded object back out when the row that names it fails', async () => {
    parkOnDisk();
    world.rpc.mockResolvedValue({ error: { message: 'Network request failed' } });

    await flushReceiptQueue();

    expect(world.put).toHaveBeenCalledTimes(1);
    expect(world.removed).toEqual([
      { bucket: 'expense-attachments', subjectId: 'e1', path: expect.any(String) },
    ]);
    // The object removed is the one just uploaded, so a retry re-uploads to the
    // same key rather than leaving a second copy behind.
    const [stored] = await storedQueue();
    expect(world.removed[0]?.path).toBe(stored?.storagePath);
    // And the capture itself is untouched: bytes on disk, entry still queued.
    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(true);
    expect(getPendingReceiptsSnapshot()[0]?.status).toBe('failed');
  });

  it('leaves the bucket alone when the bytes never reached it', async () => {
    parkOnDisk();
    world.put.mockRejectedValue(new Error('Network request failed'));

    await flushReceiptQueue();

    // Nothing was stored, so there is nothing to take back out — and asking R2
    // to delete a key that was never written is a pointless round trip on a
    // connection that has just proved itself unreliable.
    expect(world.removed).toEqual([]);
  });

  it('records the failure that mattered even when the cleanup itself fails', async () => {
    parkOnDisk();
    world.rpc.mockResolvedValue({ error: { message: 'ATTACHMENT_CAP reached' } });
    world.remove.mockRejectedValue(new Error('delete refused'));

    // A best-effort cleanup must never mask the error the entry is recording,
    // nor take the rest of the queue down with it.
    const result = await flushReceiptQueue();

    expect(result.capReached).toBe(true);
    const [stored] = await storedQueue();
    expect(stored).toMatchObject({ permanent: true });
    expect(stored?.lastError).toContain('ATTACHMENT_CAP');
  });

  it('sends a refused capture again when the person asks', async () => {
    parkOnDisk();
    world.rpc.mockResolvedValueOnce({ error: { message: 'ATTACHMENT_CAP reached' } });
    await flushReceiptQueue();
    expect(await storedQueue()).toHaveLength(1);

    // Somebody removed another receipt and tapped "try again": the backoff, the
    // recorded failure and the refusal mark are all cleared for this one.
    const result = await retryPendingReceipts(['a1']);

    expect(result.uploadedExpenseIds).toEqual(['e1']);
    expect(world.put).toHaveBeenCalledTimes(2);
    // Up, and now waiting for its row rather than for another attempt.
    expect(await storedQueue()).toMatchObject([{ attachmentId: 'a1', lastError: null }]);
    expect(getPendingReceiptsSnapshot()[0]?.status).toBe('sent');
  });

  it('drops an entry whose bytes are gone rather than retrying forever', async () => {
    storage.data.set(QUEUE_KEY, JSON.stringify([entryFor()]));

    await flushReceiptQueue();

    expect(world.put).not.toHaveBeenCalled();
    expect(await storedQueue()).toEqual([]);
  });
});

describe('a capture parked while a flush is running', () => {
  it('survives the write-back instead of being silently dropped', async () => {
    parkOnDisk();
    let latecomerFile = '';
    world.put.mockImplementation(async () => {
      const late = await enqueueReceipt({
        expenseId: 'e2',
        groupId: 'g1',
        visibility: 'group',
        base64: Buffer.from([4]).toString('base64'),
        contentType: 'image/jpeg',
      });
      latecomerFile = late.fileName;
      return 'stored';
    });

    await flushReceiptQueue();

    const queue = await storedQueue();
    // The one that went up is still here, settled and waiting for its row; the
    // latecomer is here too, untouched and still to be sent.
    expect(queue.map((entry) => entry.expenseId)).toEqual(['e1', 'e2']);
    expect(queue[1]).toMatchObject({ expenseId: 'e2', sentAt: null });
    // Its bytes are still under the pending dir — not orphaned by the write-back.
    expect(fs.files.has(pendingPath(latecomerFile))).toBe(true);
  });
});

describe('two things touching the queue at once', () => {
  it('does not lose a receipt added while another operation is writing the index', async () => {
    // The collision that matters: somebody taps add (the resize runs for a
    // second, so the enqueue lands late) while the gallery lets go of a capture
    // whose row has just arrived. Both read the same index; whoever writes last
    // used to decide, and when that was the drop, the new receipt was gone from
    // the index with its bytes orphaned under the pending dir — where the next
    // orphan sweep deletes them.
    parkOnDisk();
    await listPendingReceipts();
    await flushReceiptQueue();

    const [drop, added] = await Promise.all([
      dropSettledReceipts(['a1']),
      enqueueReceipt({
        expenseId: 'e2',
        groupId: 'g1',
        visibility: 'group',
        base64: Buffer.from([9]).toString('base64'),
        contentType: 'image/jpeg',
      }),
      // `drop` is void; `added` is the entry.
    ]);
    void drop;

    expect((await storedQueue()).map((entry) => entry.attachmentId)).toEqual([added.attachmentId]);
    expect(fs.files.has(pendingPath(added.fileName))).toBe(true);
    // And the sweep that runs on the next read leaves it alone.
    await listPendingReceipts();
    expect(fs.files.has(pendingPath(added.fileName))).toBe(true);
  });

  it('does not sweep away the bytes of a receipt being added', async () => {
    // The orphan sweep reads the index and deletes every pending file missing
    // from it. An enqueue writes bytes and index together for exactly this
    // reason — split apart, a listing in between would delete the photograph.
    const [, added] = await Promise.all([
      listPendingReceipts(),
      enqueueReceipt({
        expenseId: 'e1',
        groupId: 'g1',
        visibility: 'group',
        base64: Buffer.from([5]).toString('base64'),
        contentType: 'image/jpeg',
      }),
    ]);

    expect(fs.files.has(pendingPath(added.fileName))).toBe(true);
    expect((await storedQueue()).map((entry) => entry.attachmentId)).toEqual([added.attachmentId]);
  });

  it('lets go of a settled capture whose row never came, on the next read', async () => {
    parkOnDisk({ sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });

    expect(await listPendingReceipts()).toEqual([]);
    expect(await storedQueue()).toEqual([]);
  });
});

describe('receipt queue local privacy cleanup', () => {
  it('removes the queue index and pending receipt files on sign-out cleanup', async () => {
    const entries = [
      entryFor(),
      entryFor({
        attachmentId: 'a2',
        expenseId: 'e2',
        visibility: 'parties',
        storagePath: 'e2/a2.jpg',
        fileName: 'a2.jpg',
        createdAt: '2026-01-01T00:00:01Z',
        attempts: 1,
        lastError: 'offline',
      }),
    ];
    storage.data.set(QUEUE_KEY, JSON.stringify(entries));
    fs.dirs.add('document-root/pending-receipts');
    fs.files.set(pendingPath('a1.jpg'), new Uint8Array([1]));
    fs.files.set(pendingPath('a2.jpg'), new Uint8Array([2]));

    await clearReceiptQueue();

    expect(storage.removeItem).toHaveBeenCalledWith(QUEUE_KEY);
    expect(await listPendingReceipts()).toEqual([]);
    expect(getPendingReceiptsSnapshot()).toEqual([]);
    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(false);
    expect(fs.files.has(pendingPath('a2.jpg'))).toBe(false);
    expect(fs.dirs.has('document-root/pending-receipts')).toBe(false);
  });

  it('still removes the queue index when file deletion fails', async () => {
    storage.data.set(QUEUE_KEY, JSON.stringify([entryFor()]));
    fs.dirs.add('document-root/pending-receipts');
    fs.files.set(pendingPath('a1.jpg'), new Uint8Array([1]));
    fs.failDelete = true;

    await clearReceiptQueue();

    expect(storage.removeItem).toHaveBeenCalledWith(QUEUE_KEY);
    expect(await listPendingReceipts()).toEqual([]);
    expect(pendingReceiptUri(entryFor())).toBe(pendingPath('a1.jpg'));
  });

  it('removes orphan pending files when pending receipts are listed', async () => {
    storage.data.set(QUEUE_KEY, JSON.stringify([entryFor()]));
    fs.dirs.add('document-root/pending-receipts');
    fs.files.set(pendingPath('a1.jpg'), new Uint8Array([1]));
    fs.files.set(pendingPath('orphan.jpg'), new Uint8Array([9]));

    await expect(listPendingReceipts()).resolves.toEqual([entryFor()]);

    expect(fs.files.has(pendingPath('a1.jpg'))).toBe(true);
    expect(fs.files.has(pendingPath('orphan.jpg'))).toBe(false);
  });
});
