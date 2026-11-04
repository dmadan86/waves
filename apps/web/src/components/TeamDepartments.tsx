'use client';

/** Owner: manage the company's department list (add, rename, remove). */
import { useState } from 'react';

import { useDepartmentEditor } from '@/lib/company/departments';
import { teamStrings as s } from '@/lib/company/teamStrings';

export function TeamDepartments({ groupId }: { groupId: string }) {
  const ed = useDepartmentEditor(groupId);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>{s.departments}</h2>
      <p className="faint">{s.departmentsHint}</p>
      {ed.list.map((d) => (
        <div key={d.id} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
          {editing?.id === d.id ? (
            <>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ id: d.id, name: e.target.value })}
              />
              <button
                type="button"
                className="btn brand"
                onClick={() => ed.rename(d.id, editing.name) && setEditing(null)}
              >
                {s.save}
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }}>{d.name}</span>
              <button
                type="button"
                className="btn soft"
                onClick={() => setEditing({ id: d.id, name: d.name })}
              >
                {s.rename}
              </button>
              <button
                type="button"
                className="btn soft"
                onClick={() => window.confirm(`${s.remove} ${d.name}?`) && ed.remove(d.id)}
              >
                {s.remove}
              </button>
            </>
          )}
        </div>
      ))}
      <form
        style={{ display: 'flex', gap: 8, marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ed.add(name)) setName('');
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          aria-label={s.addDepartment}
        />
        <button type="submit" className="btn brand" disabled={!name.trim()}>
          {s.addDepartment}
        </button>
      </form>
    </section>
  );
}
