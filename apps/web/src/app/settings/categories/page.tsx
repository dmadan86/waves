'use client';

/**
 * Tags and categories (A42): one ordered list of everything the pickers show.
 *
 * The ten built-ins and this person's own tags, in one list, because that is
 * what they are — a built-in you never use and a tag you invented sit in the
 * same picker and deserve the same controls. From here: make a tag, rename or
 * recolour one, retire one, hide a built-in, and move any of them up or down so
 * the ones you reach for sit first.
 *
 * Two things about the data that shape the whole screen.
 *
 * **A built-in has no row until you touch it.** It is a position in a fixed
 * list. Hiding or moving one lazily creates an override row carrying only its
 * place and whether it is hidden — never its label, because the word lives in
 * each client's own string table and writing English into the row would freeze
 * it for somebody reading in Tamil.
 *
 * **Deleting a tag is a soft delete**, and has to be: every expense ever filed
 * under it carries its own snapshot of the label and colour, and those keep
 * working. What goes away is its place in the picker, not the history.
 *
 * Authorization is the row's own — the policy is `owner_user_id = my profile`,
 * for reads and writes alike, so this table needs no RPC in front of it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Tags } from 'lucide-react';

import { buildCatalog, nextSortOrder, TINTS, type CatalogEntry } from '@waves/core';
import type { CategoryTagRecord } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { catalogRows, moveEntry, setHidden, type CatalogWrite } from '@/lib/catalog';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

export default function CategoriesPage() {
  return <AppFrame current={Section.Settings}>{() => <Categories />}</AppFrame>;
}

function Categories() {
  const { t } = useStrings();

  const [records, setRecords] = useState<CategoryTagRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The tag being edited, '' for a new one, or null for none open. */
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRecords(await waves.categoryTags());
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.categories.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, t.errors.couldNotLoad, t.errors.offline]);

  // Built-ins are labelled from this reader's own table, never from the row.
  const builtins = t.categories as Record<string, string>;
  const { all } = useMemo(
    () => buildCatalog(catalogRows(records), (id) => builtins[id] ?? id),
    [records, builtins],
  );

  /**
   * Write, then re-read — two steps, because a commit followed by a failed
   * refresh must not be reported as "could not save".
   */
  const apply = async (writes: readonly CatalogWrite[]): Promise<boolean> => {
    if (writes.length === 0) return true;
    setBusy(true);
    setError(null);
    try {
      // In order: `sort_order` is a position, and two rows briefly sharing one
      // is only a tiebreak, not a corruption — but the last write wins the
      // final shape, so they go one at a time rather than racing.
      for (const write of writes) {
        await waves.upsertCategoryTag({
          id: write.id,
          builtinId: write.builtinId,
          label: write.label,
          icon: write.icon,
          tint: write.tint,
          sortOrder: write.sortOrder,
          hidden: write.hidden,
        });
      }
    } catch (caught) {
      setError(friendlyError(caught, 'web.categories.write', { fallback: t.errors.couldNotSave }));
      setBusy(false);
      return false;
    }
    try {
      await load();
    } catch {
      // Committed. The list is behind, not wrong.
    } finally {
      setBusy(false);
    }
    return true;
  };

  const remove = async (entry: CatalogEntry): Promise<void> => {
    if (!entry.tagId) return;
    if (!window.confirm(t.tags.deleteConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      await waves.deleteCategoryTag(entry.tagId);
    } catch (caught) {
      setError(friendlyError(caught, 'web.categories.delete', { fallback: t.errors.couldNotSave }));
      setBusy(false);
      return;
    }
    try {
      await load();
    } catch {
      // Gone from the catalog; the list catches up on the next load.
    } finally {
      setBusy(false);
    }
  };

  const saveTag = async (input: { id: string; label: string; tint: string }): Promise<void> => {
    const existing = all.find((entry) => entry.tagId === input.id && entry.custom);
    const ok = await apply([
      {
        id: input.id,
        builtinId: null,
        label: input.label,
        // Left null on a new tag: the browser has no icon set worth choosing
        // from, and core draws "Other"'s glyph for a tag without one. Editing
        // from here keeps whatever the phone chose.
        icon: existing?.icon ?? null,
        tint: input.tint,
        sortOrder: existing?.sortOrder ?? nextSortOrder(catalogRows(records)),
        hidden: existing?.hidden ?? false,
      },
    ]);
    if (ok) setEditing(null);
  };

  if (!ready) return <SkeletonRows rows={8} />;
  if (failed) return <p className="error">{failed}</p>;

  const customCount = all.filter((entry) => entry.custom).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.tags.title}</h1>
          <div className="sub">{t.tags.subtitle}</div>
        </div>
        <div className="head-actions">
          <button
            type="button"
            className="btn brand"
            disabled={busy || editing !== null}
            onClick={() => setEditing('')}
          >
            {t.tags.newTag}
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {editing === '' ? (
        <TagEditor
          busy={busy}
          onSave={(label, tint) => void saveTag({ id: crypto.randomUUID(), label, tint })}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <section className="panel">
        <div className="list">
          {all.map((entry, index) => (
            <div key={entry.key}>
              <div className="tag-row">
                <span className={`tag-dot tint-${entry.tint}`} aria-hidden />
                <span className="grow">
                  <span className="title">{entry.label}</span>
                  {entry.hidden ? <span className="meta">{t.tags.hiddenBadge}</span> : null}
                </span>

                <span className="tag-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy || index === 0}
                    aria-label={`${t.tags.moveUp} — ${entry.label}`}
                    onClick={() =>
                      void apply(moveEntry(all, entry.key, -1, () => crypto.randomUUID()))
                    }
                  >
                    <ChevronUp size={15} strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy || index === all.length - 1}
                    aria-label={`${t.tags.moveDown} — ${entry.label}`}
                    onClick={() =>
                      void apply(moveEntry(all, entry.key, 1, () => crypto.randomUUID()))
                    }
                  >
                    <ChevronDown size={15} strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="linklike"
                    disabled={busy}
                    onClick={() =>
                      void apply([setHidden(entry, !entry.hidden, () => crypto.randomUUID())])
                    }
                  >
                    {entry.hidden ? t.tags.show : t.tags.hide}
                  </button>
                  {entry.custom ? (
                    <>
                      <button
                        type="button"
                        className="linklike"
                        disabled={busy}
                        onClick={() => setEditing(entry.tagId)}
                      >
                        {t.tags.editTag}
                      </button>
                      <button
                        type="button"
                        className="linklike"
                        disabled={busy}
                        onClick={() => void remove(entry)}
                      >
                        {t.tags.deleteTag}
                      </button>
                    </>
                  ) : null}
                </span>
              </div>

              {editing && editing === entry.tagId ? (
                <TagEditor
                  busy={busy}
                  label={entry.label}
                  tint={entry.tint}
                  onSave={(label, tint) => void saveTag({ id: entry.tagId!, label, tint })}
                  onCancel={() => setEditing(null)}
                />
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {customCount === 0 ? (
        <section className="panel">
          <EmptyState Icon={Tags} title={t.tags.newTag} body={t.tags.noCustomTags} />
        </section>
      ) : null}
    </div>
  );
}

/**
 * Naming and colouring one tag.
 *
 * A name and one of six colours, and nothing else: the browser has no icon set
 * worth choosing from, so an icon somebody picked on the phone is carried
 * through untouched rather than overwritten with a guess.
 */
function TagEditor({
  busy,
  label: initialLabel,
  tint: initialTint,
  onSave,
  onCancel,
}: {
  busy: boolean;
  label?: string;
  tint?: string;
  onSave: (label: string, tint: string) => void;
  onCancel: () => void;
}) {
  const { t } = useStrings();
  const [label, setLabel] = useState(initialLabel ?? '');
  const [tint, setTint] = useState(initialTint ?? 'sky');
  const [bad, setBad] = useState(false);

  return (
    <form
      className="tag-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim()) {
          setBad(true);
          return;
        }
        onSave(label.trim(), tint);
      }}
    >
      <input
        className={bad ? 'split-input bad' : 'split-input'}
        value={label}
        autoFocus
        maxLength={40}
        aria-label={t.tags.newTag}
        aria-invalid={bad || undefined}
        placeholder={t.tags.namePlaceholder}
        onChange={(event) => {
          setLabel(event.target.value);
          setBad(false);
        }}
      />

      <span className="tint-row" role="radiogroup" aria-label={t.tags.colourLabel}>
        {TINTS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === tint}
            aria-label={option}
            className={
              option === tint ? `tint-swatch tint-${option} on` : `tint-swatch tint-${option}`
            }
            onClick={() => setTint(option)}
          />
        ))}
      </span>

      <span className="tag-editor-actions">
        <button type="submit" className="btn brand" disabled={busy}>
          {t.tags.save}
        </button>
        <button type="button" className="btn soft" onClick={onCancel}>
          {t.tags.cancel}
        </button>
      </span>

      {bad ? <p className="error">{t.tags.nameNeeded}</p> : null}
    </form>
  );
}
