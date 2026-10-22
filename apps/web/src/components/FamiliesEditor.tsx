'use client';

/**
 * Families inside a group, in settings: who travels and settles together.
 *
 * Everyone can read them; only an admin gets the controls (the server refuses
 * anyone else). The whole map is one write (`groups.units`), so each change
 * here is a single `onChange` with the next map. The ledger is untouched: a
 * family is a lens over per-person balances.
 */

import { useState } from 'react';

import {
  familyEmoji,
  familyRows,
  headOf,
  MAX_UNIT_NAME,
  placeMember,
  withFamily,
  type GroupUnits,
} from '@waves/core';
import { nameOf, type Member } from '@waves/api-client';

import { plural } from '@/i18n';
import { useStrings } from '@/i18n-context';

const OWN = '';

export function FamiliesEditor({
  units,
  members,
  canEdit,
  busy,
  onChange,
}: {
  units: GroupUnits | null;
  members: readonly Member[];
  canEdit: boolean;
  busy: boolean;
  onChange: (next: GroupUnits | null) => void;
}) {
  const { t, locale } = useStrings();
  const { families, onTheirOwn } = familyRows(units, members);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [draft, setDraft] = useState<{ name: string; ids: string[] } | null>(null);

  const move = (memberId: string, familyId: string) =>
    onChange(placeMember(units, memberId, familyId === OWN ? null : familyId));

  const mover = (memberId: string, current: string) => (
    <select
      value={current}
      disabled={busy}
      aria-label={nameOf(members.find((m) => m.id === memberId) as Member)}
      onChange={(event) => move(memberId, event.target.value)}
      style={{ width: 'auto' }}
    >
      <option value={OWN}>
        {current === OWN ? t.families.addToFamily : t.families.onTheirOwn}
      </option>
      {families.map((family) => (
        <option key={family.id} value={family.id}>
          {family.unit.name}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      <p className="faint">{t.families.intro}</p>

      {families.map((family) => {
        const head = headOf(family.unit);
        return (
          <div key={family.id} style={{ marginBlockStart: 12 }}>
            <div className="item" style={{ cursor: 'default' }}>
              <span className="tile-emoji" aria-hidden>
                {familyEmoji(family.members.length)}
              </span>
              {renaming?.id === family.id ? (
                <input
                  value={renaming.name}
                  maxLength={MAX_UNIT_NAME}
                  aria-label={t.families.nameLabel}
                  onChange={(event) => setRenaming({ id: family.id, name: event.target.value })}
                />
              ) : (
                <span className="grow">
                  <span className="title">{family.unit.name}</span>
                  <span className="meta">
                    {plural(locale, family.members.length, t.group.peopleCount)}
                  </span>
                </span>
              )}
              {canEdit && renaming?.id === family.id ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !renaming.name.trim()}
                  onClick={() => {
                    onChange(
                      withFamily(units, family.id, { ...family.unit, name: renaming.name.trim() }),
                    );
                    setRenaming(null);
                  }}
                >
                  {t.families.save}
                </button>
              ) : canEdit ? (
                <>
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy}
                    onClick={() => setRenaming({ id: family.id, name: family.unit.name })}
                  >
                    {t.families.rename}
                  </button>
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t.families.deleteConfirm)) {
                        onChange(withFamily(units, family.id, null));
                      }
                    }}
                  >
                    {t.families.delete}
                  </button>
                </>
              ) : null}
            </div>
            {family.members.map((member) => (
              <div
                key={member.id}
                className="item"
                style={{ cursor: 'default', paddingInlineStart: 28 }}
              >
                <span className="grow">
                  <span className="title">{nameOf(member)}</span>
                  {member.id === head ? <span className="meta">{t.families.head}</span> : null}
                </span>
                {canEdit && member.id !== head ? (
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy}
                    onClick={() =>
                      onChange(withFamily(units, family.id, { ...family.unit, head: member.id }))
                    }
                  >
                    {t.families.makeHead}
                  </button>
                ) : null}
                {canEdit ? mover(member.id, family.id) : null}
              </div>
            ))}
          </div>
        );
      })}

      {onTheirOwn.length > 0 && families.length > 0 ? (
        <div style={{ marginBlockStart: 12 }}>
          <p className="faint">{t.families.onTheirOwn}</p>
          {onTheirOwn.map((member) => (
            <div key={member.id} className="item" style={{ cursor: 'default' }}>
              <span className="grow">
                <span className="title">{nameOf(member)}</span>
              </span>
              {canEdit && families.length > 0 ? mover(member.id, OWN) : null}
            </div>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        draft ? (
          <div style={{ marginBlockStart: 12 }}>
            <label className="field">
              <span className="field-label">{t.families.nameLabel}</span>
              <input
                value={draft.name}
                maxLength={MAX_UNIT_NAME}
                autoComplete="off"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <div className="field">
              <span className="field-label">{t.families.pickPeople}</span>
              <div className="people">
                {onTheirOwn.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="chip"
                    aria-pressed={draft.ids.includes(member.id)}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        ids: draft.ids.includes(member.id)
                          ? draft.ids.filter((id) => id !== member.id)
                          : [...draft.ids, member.id],
                      })
                    }
                  >
                    {nameOf(member)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn"
                disabled={busy || !draft.name.trim() || draft.ids.length === 0}
                onClick={() => {
                  onChange(
                    withFamily(units, crypto.randomUUID(), {
                      name: draft.name.trim(),
                      members: draft.ids,
                      head: draft.ids[0],
                    }),
                  );
                  setDraft(null);
                }}
              >
                {t.families.create}
              </button>
              <button type="button" className="btn soft" onClick={() => setDraft(null)}>
                {t.families.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn soft"
            style={{ marginBlockStart: 12 }}
            disabled={busy || onTheirOwn.length === 0}
            onClick={() => setDraft({ name: '', ids: [] })}
          >
            {t.families.newFamily}
          </button>
        )
      ) : (
        <p className="faint">{t.families.adminOnly}</p>
      )}
    </div>
  );
}
