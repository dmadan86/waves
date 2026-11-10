import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager A, 2 manager B, 3 employee, 4 vendor login.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const [OWNER, MGR_A, MGR_B, EMP, VENDOR] = [0, 1, 2, 3, 4];

async function user<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i], role: 'authenticated' }),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    return await run();
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT actor_scope');
    throw error;
  } finally {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',true)");
    await db.query('RELEASE SAVEPOINT actor_scope');
  }
}
async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}
async function denied(run: () => Promise<unknown>, pattern?: RegExp) {
  await db.query('SAVEPOINT expected_failure');
  try {
    const message = await expectDenied(run());
    if (pattern) expect(message).toMatch(pattern);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'manager', 'member', 'vendor'];
  for (let i = 0; i < 5; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      g.memberIds[i],
      g.groupId,
      g.profileIds[i],
      roles[i],
    ]);
});
afterAll(async () => {
  if (db) await db.end();
});

const link = (
  caller: number,
  name: string,
  visibility = 'everyone',
  url = 'https://example.com/a',
  folder: string | null = null,
) =>
  user(caller, async () => {
    const id = randomUUID();
    await db.query('SELECT waves_company_file_create($1,$2,$3,$4,$5,$6,$7)', [
      g.groupId,
      id,
      folder,
      'link',
      name,
      visibility,
      url,
    ]);
    return id;
  });
const folder = (caller: number, name: string, visibility = 'everyone') =>
  user(caller, async () => {
    const id = randomUUID();
    await db.query('SELECT waves_company_file_folder_set($1,$2,$3,$4)', [
      g.groupId,
      id,
      name,
      visibility,
    ]);
    return id;
  });
const seenBy = (caller: number) =>
  user(caller, async () =>
    (
      await db.query('SELECT name FROM company_files WHERE deleted_at IS NULL ORDER BY name')
    ).rows.map((r) => r.name as string),
  );
const key = (id: string) => `cf/${g.groupId}/${id}`;
const PDF = 'application/pdf';
// The byte door runs as the service role on behalf of the caller's profile.
const reserve = (caller: number, id: string, bytes = 1000, type = PDF) =>
  db.query("SELECT waves_storage_reserve($1,$2,'company-entry-images',$3,$4,$5)", [
    g.profileIds[caller],
    g.groupId,
    key(id),
    bytes,
    type,
  ]);
const commit = (caller: number, id: string, bytes = 1000, type = PDF) =>
  db.query("SELECT waves_storage_record($1,$2,'company-entry-images',$3,$4,$5)", [
    g.profileIds[caller],
    g.groupId,
    key(id),
    bytes,
    type,
  ]);
async function upload(caller: number, name: string, visibility = 'everyone', bytes = 1000) {
  const id = randomUUID();
  await reserve(caller, id, bytes);
  await commit(caller, id, bytes);
  await user(caller, () =>
    db.query('SELECT waves_company_file_create($1,$2,NULL,$3,$4,$5)', [
      g.groupId,
      id,
      'file',
      name,
      visibility,
    ]),
  );
  return id;
}

describe('company files: who sees what', () => {
  it('shows each role the items whose visibility includes it, and a vendor nothing', () =>
    isolated(async () => {
      await link(OWNER, 'a-everyone', 'everyone');
      await link(OWNER, 'b-managers', 'managers');
      await link(OWNER, 'c-owners', 'owners');
      expect(await seenBy(OWNER)).toEqual(['a-everyone', 'b-managers', 'c-owners']);
      expect(await seenBy(MGR_A)).toEqual(['a-everyone', 'b-managers']);
      expect(await seenBy(MGR_B)).toEqual(['a-everyone', 'b-managers']);
      expect(await seenBy(EMP)).toEqual(['a-everyone']);
      expect(await seenBy(VENDOR)).toEqual([]);
    }));

  it('hides what is inside a folder the viewer cannot see, and folders follow the same rule', () =>
    isolated(async () => {
      const secret = await folder(OWNER, 'Secret', 'owners');
      const open = await folder(OWNER, 'Open', 'everyone');
      await link(OWNER, 'in-secret', 'everyone', 'https://example.com/s', secret);
      await link(OWNER, 'in-open', 'everyone', 'https://example.com/o', open);
      expect(await seenBy(EMP)).toEqual(['in-open']);
      expect(await seenBy(MGR_A)).toEqual(['in-open']);
      const folders = (who: number) =>
        user(who, async () =>
          (await db.query('SELECT name FROM company_file_folders ORDER BY name')).rows.map(
            (r) => r.name,
          ),
        );
      expect(await folders(OWNER)).toEqual(['Open', 'Secret']);
      expect(await folders(EMP)).toEqual(['Open']);
      expect(await folders(VENDOR)).toEqual([]);
    }));

  it('stops showing an item the moment its visibility narrows', () =>
    isolated(async () => {
      const id = await link(OWNER, 'wide', 'everyone');
      expect(await seenBy(EMP)).toEqual(['wide']);
      await user(OWNER, () =>
        db.query('SELECT waves_company_file_update($1,NULL,$2,$3,$4)', [
          id,
          'wide',
          'owners',
          'https://example.com/a',
        ]),
      );
      expect(await seenBy(EMP)).toEqual([]);
      expect(await seenBy(MGR_A)).toEqual([]);
    }));
});

describe('company files: who may change what', () => {
  it('lets only owners and managers create; employees and vendors are refused', () =>
    isolated(async () => {
      await link(MGR_A, 'by-manager');
      await denied(() => link(EMP, 'nope'), /NOT_ALLOWED/);
      await denied(() => link(VENDOR, 'nope'), /NOT_ALLOWED/);
      await denied(() => folder(EMP, 'nope'), /NOT_ALLOWED/);
      await denied(() => user(EMP, () => db.query("UPDATE company_files SET name='x'")));
    }));

  it("stops a manager deleting or editing someone else's item, but not their own", () =>
    isolated(async () => {
      const mine = await link(MGR_A, 'mine');
      const owners = await link(OWNER, 'owners-item');
      const theirs = await link(MGR_B, 'theirs');
      await denied(
        () => user(MGR_A, () => db.query('SELECT waves_company_file_delete($1)', [owners])),
        /NOT_ALLOWED/,
      );
      await denied(
        () => user(MGR_A, () => db.query('SELECT waves_company_file_delete($1)', [theirs])),
        /NOT_ALLOWED/,
      );
      await denied(
        () =>
          user(MGR_A, () =>
            db.query('SELECT waves_company_file_update($1,NULL,$2,$3,$4)', [
              theirs,
              'x',
              'everyone',
              'https://example.com',
            ]),
          ),
        /NOT_ALLOWED/,
      );
      await user(MGR_A, () => db.query('SELECT waves_company_file_delete($1)', [mine]));
      await user(OWNER, () => db.query('SELECT waves_company_file_delete($1)', [theirs]));
      expect(await seenBy(OWNER)).toEqual(['owners-item']);
    }));

  it("stops a manager hiding an item from themself with owners-only, and deleting a folder holding others' files", () =>
    isolated(async () => {
      await denied(() => link(MGR_A, 'self-hide', 'owners'), /NOT_ALLOWED/);
      await denied(() => folder(MGR_A, 'self-hide', 'owners'), /NOT_ALLOWED/);
      const f = await folder(MGR_A, 'Shared');
      await link(MGR_B, 'b-in-a', 'everyone', 'https://example.com/b', f);
      await denied(
        () => user(MGR_A, () => db.query('SELECT waves_company_file_folder_delete($1)', [f])),
        /NOT_ALLOWED/,
      );
      await user(OWNER, () => db.query('SELECT waves_company_file_folder_delete($1)', [f]));
      expect(await seenBy(OWNER)).toEqual([]);
    }));

  it('lets nobody write the tables directly', () =>
    isolated(async () => {
      await denied(() =>
        user(OWNER, () =>
          db.query(
            "INSERT INTO company_files(id,group_id,kind,name,url,created_by) VALUES($1,$2,'link','x','https://x.io',$3)",
            [randomUUID(), g.groupId, g.memberIds[0]],
          ),
        ),
      );
    }));
});

describe('company files: items under a folder the owner hid', () => {
  it('stops the manager re-opening that folder, moving their file out of it, or deleting it', () =>
    isolated(async () => {
      const f = await folder(MGR_A, 'Mine');
      const id = await link(MGR_A, 'inside', 'everyone', 'https://example.com/i', f);
      await user(OWNER, () =>
        db.query('SELECT waves_company_file_folder_set($1,$2,$3,$4)', [
          g.groupId,
          f,
          'Mine',
          'owners',
        ]),
      );
      await denied(
        () =>
          user(MGR_A, () =>
            db.query('SELECT waves_company_file_folder_set($1,$2,$3,$4)', [
              g.groupId,
              f,
              'Mine',
              'everyone',
            ]),
          ),
        /NOT_ALLOWED/,
      );
      await denied(
        () =>
          user(MGR_A, () =>
            db.query('SELECT waves_company_file_update($1,NULL,$2,$3,$4)', [
              id,
              'inside',
              'everyone',
              'https://example.com/i',
            ]),
          ),
        /NOT_ALLOWED/,
      );
      await denied(
        () => user(MGR_A, () => db.query('SELECT waves_company_file_delete($1)', [id])),
        /NOT_ALLOWED/,
      );
      expect(await seenBy(EMP)).toEqual([]);
      expect(await seenBy(OWNER)).toEqual(['inside']);
    }));
});

describe('company files: link addresses', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'example.com/no-scheme',
    'https://exa mple.com',
    'HTTPS://example.com/ok-but-' + 'x'.repeat(2100),
  ])('refuses %s', (url) =>
    isolated(async () => {
      await denied(() => link(OWNER, 'bad', 'everyone', url), /INVALID_DATA|check/i);
    }),
  );

  it('accepts http and https in any case, and the table itself refuses a bad scheme', () =>
    isolated(async () => {
      await link(OWNER, 'one', 'everyone', 'http://example.com');
      await link(OWNER, 'two', 'everyone', 'HTTPS://drive.google.com/file/d/1/view?usp=sharing');
      await denied(
        () =>
          db.query(
            "INSERT INTO company_files(id,group_id,kind,name,url,created_by) VALUES($1,$2,'link','x','javascript:alert(1)',$3)",
            [randomUUID(), g.groupId, g.memberIds[0]],
          ),
        /company_files_url_check|violates check/,
      );
    }));

  it('limits names', () =>
    isolated(async () => {
      await denied(() => link(OWNER, '   '), /INVALID_DATA/);
      await denied(() => link(OWNER, 'n'.repeat(121)), /INVALID_DATA/);
      await denied(() => folder(OWNER, 'f'.repeat(81)), /INVALID_DATA/);
    }));
});

describe('company files: uploads and quota', () => {
  it('registers an uploaded file, counts it against the company quota, and frees it on delete', () =>
    isolated(async () => {
      const id = await upload(MGR_A, 'plan.pdf', 'everyone', 5000);
      expect(await seenBy(EMP)).toEqual(['plan.pdf']);
      const used = () =>
        db.query(
          "SELECT coalesce(sum(bytes),0)::int AS n FROM storage_objects WHERE company_group_id=$1 AND logical_bucket='company-entry-images'",
          [g.groupId],
        );
      expect((await used()).rows[0]?.n).toBe(5000);
      const row = await user(EMP, () =>
        db.query('SELECT size_bytes,mime,r2_key FROM company_files WHERE id=$1', [id]),
      );
      expect(row.rows[0]).toMatchObject({ size_bytes: '5000', mime: PDF, r2_key: key(id) });
      await user(MGR_A, () => db.query('SELECT waves_company_file_delete($1)', [id]));
      expect((await used()).rows[0]?.n).toBe(0);
      expect(await seenBy(OWNER)).toEqual([]);
    }));

  it('refuses uploads from employees and vendors, and bad types and sizes', () =>
    isolated(async () => {
      await denied(() => reserve(EMP, randomUUID()), /NOT_ALLOWED/);
      await denied(() => reserve(VENDOR, randomUUID()), /NOT_ALLOWED/);
      await denied(() => reserve(OWNER, randomUUID(), 1000, 'text/html'), /STORAGE_BAD_INPUT/);
      await denied(() => reserve(OWNER, randomUUID(), 1000, 'image/svg+xml'), /STORAGE_BAD_INPUT/);
      await denied(() => reserve(OWNER, randomUUID(), 26214401), /STORAGE_BAD_INPUT/);
      await denied(() => reserve(OWNER, randomUUID(), 0), /STORAGE_BAD_INPUT/);
    }));

  it("refuses an upload past the company quota and one under another company's key", () =>
    isolated(async () => {
      await db.query('UPDATE company_plans SET storage_quota_bytes=1500 WHERE group_id=$1', [
        g.groupId,
      ]);
      await upload(OWNER, 'first.pdf', 'everyone', 1000);
      await denied(() => reserve(OWNER, randomUUID(), 1000), /STORAGE_CAP/);
      await denied(
        () =>
          db.query("SELECT waves_storage_reserve($1,$2,'company-entry-images',$3,10,$4)", [
            g.profileIds[OWNER],
            g.groupId,
            `cf/${randomUUID()}/${randomUUID()}`,
            PDF,
          ]),
        /STORAGE_BAD_INPUT/,
      );
    }));

  it('will not register a file that was never uploaded or was uploaded by someone else', () =>
    isolated(async () => {
      const id = randomUUID();
      await denied(
        () =>
          user(OWNER, () =>
            db.query("SELECT waves_company_file_create($1,$2,NULL,'file','x.pdf','everyone')", [
              g.groupId,
              id,
            ]),
          ),
        /NOT_UPLOADED/,
      );
      await reserve(MGR_A, id);
      await commit(MGR_A, id);
      await denied(
        () =>
          user(MGR_B, () =>
            db.query("SELECT waves_company_file_create($1,$2,NULL,'file','x.pdf','everyone')", [
              g.groupId,
              id,
            ]),
          ),
        /NOT_UPLOADED/,
      );
    }));

  it('answers byte reads by visibility', () =>
    isolated(async () => {
      const id = await upload(OWNER, 'budget.pdf', 'managers');
      const can = (who: number) =>
        user(
          who,
          async () =>
            (await db.query('SELECT waves_can_read_company_file($1,$2) AS ok', [id, key(id)]))
              .rows[0]?.ok,
        );
      expect(await can(OWNER)).toBe(true);
      expect(await can(MGR_B)).toBe(true);
      expect(await can(EMP)).toBe(false);
      expect(await can(VENDOR)).toBe(false);
      const wrong = await user(OWNER, () =>
        db.query('SELECT waves_can_read_company_file($1,$2) AS ok', [id, key(randomUUID())]),
      );
      expect(wrong.rows[0]?.ok).toBe(false);
    }));

  it("deleting a folder frees its files' bytes", () =>
    isolated(async () => {
      const f = await folder(OWNER, 'Plans');
      const id = randomUUID();
      await reserve(OWNER, id, 700);
      await commit(OWNER, id, 700);
      await user(OWNER, () =>
        db.query("SELECT waves_company_file_create($1,$2,$3,'file','p.pdf','everyone')", [
          g.groupId,
          id,
          f,
        ]),
      );
      await user(OWNER, () => db.query('SELECT waves_company_file_folder_delete($1)', [f]));
      const left = await db.query('SELECT 1 FROM storage_objects WHERE path=$1', [key(id)]);
      expect(left.rowCount).toBe(0);
      expect(await seenBy(OWNER)).toEqual([]);
    }));
});
