'use client';

/** Team > Work: daily tasks grouped by day or person; add, edit, change status, repeat, remove, photos. */
import { useMemo, useRef, useState } from 'react';
import { materialiseCompanyProjects, type CompanyWorkSetPayload } from '@waves/core';

import { SegmentedTabs } from '@/components/SegmentedTabs';
import { memberName, todayIso, useCompanyView, type CompanyMember } from '@/lib/company/view';
import { useCompanyPhotos } from '@/lib/company/entryActions';
import { workStrings as s } from '@/lib/company/workStrings';
import {
  addTaskPayloads,
  filterWork,
  groupWorkTasks,
  MAX_TASK_PHOTOS,
  maxTaskDay,
  shiftDay,
  taskPayload,
  type WorkMode,
} from '@/lib/company/workTasks';
import { attachTaskPhoto, removeTaskPhoto } from '@/lib/company/workPhotos';
import {
  useWorkdayAccess,
  useWorkdayActions,
  useWorkTasks,
  type MirrorWorkTask,
} from '@/lib/company/workday';
import { NO_QUEUE, useSync } from '@/lib/sync';
import { StorageCapError } from '@/lib/upload';

type Payload = CompanyWorkSetPayload;
type Status = Payload['status'];
type Panel = { kind: 'add' } | { kind: 'edit'; draft: Payload } | { kind: 'status'; id: string };

const STATUSES: Status[] = ['todo', 'doing', 'done', 'blocked'];
const label = (st: Status) => s[st];

function Photos({ taskId, canRemove }: { taskId: string; canRemove: boolean }) {
  const photos = useCompanyPhotos(taskId);
  const [err, setErr] = useState('');
  if (photos.length === 0) return null;
  return (
    <div>
      <strong>{s.photos}</strong>
      {photos.map((p, i) => (
        <div key={p.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
          {p.preview?.startsWith('data:') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.preview} alt="" width={48} height={48} />
          ) : (
            <span>{`${s.photos} ${i + 1}`}</span>
          )}
          {canRemove ? (
            <button
              type="button"
              className="btn soft"
              onClick={() => removeTaskPhoto(p.id).catch((e: Error) => setErr(e.message))}
            >
              {s.removePhoto}
            </button>
          ) : null}
        </div>
      ))}
      {err ? <p role="alert">{err}</p> : null}
    </div>
  );
}

export function TeamWork({ groupId }: { groupId: string }) {
  const view = useCompanyView(groupId);
  const access = useWorkdayAccess(groupId);
  const tasks = useWorkTasks(groupId);
  const { mirror, refresh } = useSync();
  const { setTask, removeTask } = useWorkdayActions(groupId);
  const sites = useMemo(
    () => materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter((p) => !p.archived_at),
    [mirror, groupId],
  );
  const today = todayIso();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [mode, setMode] = useState<WorkMode>('date');
  const [scope, setScope] = useState<'mine' | 'team'>(access.isEmployee ? 'mine' : 'team');
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const people: readonly CompanyMember[] =
    access.isEmployee && access.me ? [access.me] : access.people;
  const someone = 'Someone';
  const personName = (id: string) =>
    memberName(people.find((p) => p.id === id) ?? access.me ?? undefined, '');
  const siteName = (id: string | null) => (id && sites.find((p) => p.id === id)?.name) || '';
  const allowedPerson = (id: string) => access.canManage && access.people.some((p) => p.id === id);
  const canChange = (t: MirrorWorkTask) =>
    access.enabled &&
    (allowedPerson(t.memberId) || (access.isEmployee && t.memberId === access.me?.id));

  const own = tasks.filter((t) => canChange(t) && (scope === 'team' || t.memberId === view.me?.id));
  const grouped = groupWorkTasks(filterWork(own, query, personName, siteName), {
    mode: access.canManage ? mode : 'date',
    today,
    personName,
  });

  /** The phone's write(): same limits, and an employee may only change status, reason and note. */
  const write = async (next: Payload, after?: () => void) => {
    const current = tasks.find((t) => t.id === next.taskId);
    if (
      !access.enabled ||
      busy ||
      next.day > maxTaskDay(today) ||
      !next.title.trim() ||
      next.title.length > 200 ||
      (next.note?.length ?? 0) > 200 ||
      (next.blockedReason?.length ?? 0) > 120 ||
      (next.status === 'blocked' && !next.blockedReason?.trim())
    )
      return;
    if (!allowedPerson(next.memberId)) {
      if (
        !current ||
        !access.isEmployee ||
        current.memberId !== access.me?.id ||
        next.memberId !== current.memberId ||
        next.day !== current.day ||
        next.title !== current.title ||
        next.projectId !== current.projectId
      )
        return;
    }
    setError('');
    setBusy(true);
    try {
      await setTask(next);
      after?.();
    } catch {
      setError(s.saveError);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (t: MirrorWorkTask, status: Status) => {
    if (!canChange(t) || busy) return;
    if (status === 'blocked') setPanel({ kind: 'status', id: t.id });
    else void write({ ...taskPayload(t), status, blockedReason: null });
  };

  const del = async (t: MirrorWorkTask) => {
    if (!allowedPerson(t.memberId) || busy || !window.confirm(`${t.title}?`)) return;
    setError('');
    setBusy(true);
    try {
      await removeTask({ taskId: t.id });
    } catch {
      setError(s.saveError);
    } finally {
      setBusy(false);
    }
  };

  const row = (t: MirrorWorkTask) => {
    const late = t.status !== 'done' && t.day < today;
    return (
      <div key={t.id} className="card row" style={{ gap: 8, alignItems: 'center', padding: 8 }}>
        <input
          type="checkbox"
          aria-label={s.done}
          checked={t.status === 'done'}
          disabled={!canChange(t) || busy}
          onChange={() => changeStatus(t, t.status === 'done' ? 'todo' : 'done')}
        />
        <button
          type="button"
          className="btn soft"
          style={{ flex: 1, textAlign: 'start' }}
          disabled={busy}
          onClick={() =>
            access.canManage && canChange(t)
              ? setPanel({ kind: 'edit', draft: taskPayload(t) })
              : setPanel({ kind: 'status', id: t.id })
          }
        >
          {`#${t.number ?? '—'} ${t.title}`}
          <small style={{ display: 'block', color: late ? 'crimson' : undefined }}>
            {[
              t.day === today ? s.today : t.day,
              t.dueTime,
              siteName(t.projectId),
              personName(t.memberId),
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </button>
        <span>{label(t.status)}</span>
        {access.canManage && canChange(t) ? (
          <>
            <button
              type="button"
              className="btn soft"
              disabled={busy}
              onClick={() => setPanel({ kind: 'status', id: t.id })}
            >
              {s.status}
            </button>
            {t.status !== 'done' && shiftDay(t.day, 1) <= maxTaskDay(today) ? (
              <button
                type="button"
                className="btn soft"
                disabled={busy}
                onClick={() =>
                  void write({
                    ...taskPayload(t),
                    taskId: crypto.randomUUID(),
                    day: shiftDay(t.day, 1),
                    status: 'todo',
                    blockedReason: null,
                  })
                }
              >
                {s.repeat}
              </button>
            ) : null}
            <button type="button" className="btn soft" disabled={busy} onClick={() => void del(t)}>
              {s.remove}
            </button>
          </>
        ) : null}
      </div>
    );
  };

  const heading = (sec: (typeof grouped.sections)[number]) =>
    sec.kind === 'overdue'
      ? `${s.overdue} · ${sec.tasks.length}`
      : sec.kind === 'day'
        ? sec.ref === today
          ? s.today
          : new Date(`${sec.ref}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
        : `${personName(sec.ref) || someone} · ${s.openN.replace('{n}', String(sec.open))}`;

  const statusTask = panel?.kind === 'status' ? tasks.find((t) => t.id === panel.id) : undefined;

  return (
    <div>
      {!access.enabled ? (
        <p>{s.empty}</p>
      ) : (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {access.canManage ? (
              <SegmentedTabs
                label={s.viewLabel}
                value={mode}
                onChange={setMode}
                tabs={[
                  { value: 'date', label: s.byDate },
                  { value: 'person', label: s.byPerson },
                ]}
              />
            ) : null}
            <input
              type="search"
              aria-label={s.search}
              placeholder={s.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {access.canManage ? (
              <label>
                <input
                  type="checkbox"
                  checked={scope === 'mine'}
                  onChange={(e) => setScope(e.target.checked ? 'mine' : 'team')}
                />{' '}
                {s.mine}
              </label>
            ) : null}
            {access.canManage && access.people.length > 0 ? (
              <button
                type="button"
                className="btn brand"
                disabled={busy}
                onClick={() => setPanel({ kind: 'add' })}
              >
                {s.add}
              </button>
            ) : null}
          </div>

          {panel?.kind === 'add' ? (
            <AddTask
              groupId={groupId}
              people={access.people}
              today={today}
              onClose={() => setPanel(null)}
              save={setTask}
              refresh={refresh}
            />
          ) : null}
          {panel?.kind === 'edit' ? (
            <EditTask
              draft={panel.draft}
              setDraft={(draft) => setPanel({ kind: 'edit', draft })}
              people={access.people}
              sites={sites}
              today={today}
              busy={busy}
              error={error}
              canSave={allowedPerson(panel.draft.memberId)}
              canRemovePhoto={access.canManage}
              onSave={() =>
                void write({ ...panel.draft, title: panel.draft.title.trim() }, () =>
                  setPanel(null),
                )
              }
              onClose={() => setPanel(null)}
            />
          ) : null}
          {statusTask ? (
            <StatusPanel
              key={statusTask.id}
              task={statusTask}
              enabled={canChange(statusTask) && !busy}
              error={error}
              onClose={() => setPanel(null)}
              onPick={(status, text) => {
                const base = taskPayload(statusTask);
                const next: Payload =
                  status === 'blocked'
                    ? { ...base, status, blockedReason: text || statusTask.blockedReason }
                    : {
                        ...base,
                        status,
                        blockedReason: null,
                        // Add to the task's note, never replace it.
                        note: text
                          ? statusTask.note
                            ? `${statusTask.note}\n${text}`
                            : text
                          : statusTask.note,
                      };
                void write(next, () => setPanel(null));
              }}
            />
          ) : null}

          {grouped.sections.length === 0 && grouped.done.length === 0 ? <p>{s.noTasks}</p> : null}
          {grouped.sections.map((sec) => (
            <section key={sec.key}>
              <h3
                style={{
                  color:
                    sec.kind === 'overdue' || (sec.kind === 'person' && sec.alert > 0)
                      ? 'crimson'
                      : undefined,
                }}
              >
                {heading(sec)}
              </h3>
              {sec.tasks.map(row)}
            </section>
          ))}
          {grouped.done.length > 0 ? (
            <section>
              <button
                type="button"
                className="btn soft"
                aria-expanded={showDone}
                onClick={() => setShowDone((v) => !v)}
              >
                {s.doneN.replace('{n}', String(grouped.done.length))}
              </button>
              {showDone ? grouped.done.map(row) : null}
            </section>
          ) : null}
          {error && panel?.kind !== 'edit' && panel?.kind !== 'status' ? (
            <p role="alert">{error}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatusPanel({
  task,
  enabled,
  error,
  onPick,
  onClose,
}: {
  task: MirrorWorkTask;
  enabled: boolean;
  error: string;
  onPick: (status: Status, text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [needReason, setNeedReason] = useState(false);
  const pick = (status: Status) => {
    if (status === 'blocked' && !text.trim() && !task.blockedReason) {
      setNeedReason(true);
      return;
    }
    onPick(status, text.trim());
  };
  return (
    <div className="card" style={{ padding: 12 }}>
      <h3>{`${s.updateStatus}: #${task.number ?? '—'} ${task.title}`}</h3>
      {[task.blockedReason, task.note].filter(Boolean).map((v, i) => (
        <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
          {v}
        </p>
      ))}
      <div className="row" style={{ gap: 8 }}>
        {STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            className={task.status === st ? 'btn brand' : 'btn soft'}
            disabled={!enabled}
            aria-pressed={task.status === st}
            onClick={() => pick(st)}
          >
            {label(st)}
          </button>
        ))}
      </div>
      <textarea
        aria-label={s.addNote}
        placeholder={s.addNote}
        maxLength={120}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim()) setNeedReason(false);
        }}
      />
      {needReason ? <p role="alert">{s.reason}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <Photos taskId={task.id} canRemove={false} />
      <button type="button" className="btn soft" onClick={onClose}>
        {s.close}
      </button>
    </div>
  );
}

function EditTask({
  draft,
  setDraft,
  people,
  sites,
  today,
  busy,
  error,
  canSave,
  canRemovePhoto,
  onSave,
  onClose,
}: {
  draft: Payload;
  setDraft: (d: Payload) => void;
  people: readonly CompanyMember[];
  sites: readonly { id: string; name: string }[];
  today: string;
  busy: boolean;
  error: string;
  canSave: boolean;
  canRemovePhoto: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <form
      className="card"
      style={{ padding: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <h3>{s.edit}</h3>
      <label className="field">
        <span className="field-label">{s.titleField}</span>
        <input
          value={draft.title}
          maxLength={200}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">{s.assignTo}</span>
        <select
          value={draft.memberId}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, memberId: e.target.value })}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {memberName(p, '')}
            </option>
          ))}
        </select>
      </label>
      {sites.length > 0 ? (
        <label className="field">
          <span className="field-label">{s.site}</span>
          <select
            value={draft.projectId ?? ''}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, projectId: e.target.value || null })}
          >
            <option value="">{s.noSite}</option>
            {sites.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span className="field-label">{s.due}</span>
        <input
          type="date"
          required
          value={draft.day}
          min={draft.day < today ? draft.day : today}
          max={maxTaskDay(today)}
          disabled={busy}
          onChange={(e) => e.target.value && setDraft({ ...draft, day: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">{s.time}</span>
        <input
          type="time"
          value={draft.dueTime ?? ''}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, dueTime: e.target.value || null })}
        />
      </label>
      <label className="field">
        <span className="field-label">{s.notesOptional}</span>
        <textarea
          value={draft.note ?? ''}
          maxLength={200}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
        />
      </label>
      {draft.blockedReason ? <p>{draft.blockedReason}</p> : null}
      <Photos taskId={draft.taskId} canRemove={canRemovePhoto} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="row" style={{ gap: 8 }}>
        <button
          type="submit"
          className="btn brand"
          disabled={
            busy ||
            !draft.title.trim() ||
            !canSave ||
            (draft.projectId !== null && !sites.some((p) => p.id === draft.projectId))
          }
        >
          {s.save}
        </button>
        <button type="button" className="btn soft" disabled={busy} onClick={onClose}>
          {s.cancel}
        </button>
      </div>
    </form>
  );
}

function AddTask({
  groupId,
  people,
  today,
  onClose,
  save,
  refresh,
}: {
  groupId: string;
  people: readonly CompanyMember[];
  today: string;
  onClose: () => void;
  save: (p: Payload) => Promise<unknown>;
  refresh: () => Promise<unknown> | void;
}) {
  const maxDay = maxTaskDay(today);
  const [title, setTitle] = useState('');
  const [ids, setIds] = useState<string[]>(people.length === 1 ? [people[0]!.id] : []);
  const [day, setDay] = useState(today);
  const [files, setFiles] = useState<{ key: string; file: File }[]>([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  // A retry after a failed photo must not make a second task or a second copy of a photo that went up.
  const taskIds = useRef(new Map<string, string>());
  const uploaded = useRef(new Set<string>());

  const submit = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t || t.length > 200) return setProblem(s.needTitle);
    if (ids.length === 0 || ids.some((id) => !people.some((p) => p.id === id)))
      return setProblem(s.needPeople);
    if (day < today || day > maxDay) return setProblem(s.badDay);
    setBusy(true);
    setProblem('');
    const payloads = addTaskPayloads({
      title,
      memberIds: ids,
      day,
      idFor: (memberId) => {
        const known = taskIds.current.get(memberId);
        if (known) return known;
        const fresh = crypto.randomUUID();
        taskIds.current.set(memberId, fresh);
        return fresh;
      },
    });
    try {
      for (const p of payloads) await save(p);
    } catch {
      setProblem(s.saveError);
      setBusy(false);
      return;
    }
    if (files.length > 0) {
      let failed = false;
      let full = false;
      try {
        // The photos attach to real server rows, so the queued tasks go up first.
        await refresh();
        for (const p of payloads)
          for (const f of files) {
            const mark = `${p.taskId}:${f.key}`;
            if (uploaded.current.has(mark)) continue;
            try {
              await attachTaskPhoto(groupId, p.taskId, f.file);
              uploaded.current.add(mark);
            } catch (caught) {
              if (caught instanceof StorageCapError) full = true;
              else failed = true;
            }
          }
      } catch {
        failed = true;
      }
      if (full) setProblem(s.storageFull);
      if (failed) {
        setProblem(s.photoFailed);
        setBusy(false);
        return;
      }
      if (full) {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onClose();
  };

  return (
    <form
      className="card"
      style={{ padding: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{s.add}</h3>
      <label className="field">
        <span className="field-label">{s.description}</span>
        <textarea
          value={title}
          maxLength={200}
          placeholder={s.descriptionHint}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <fieldset>
        <legend>{s.assignTo}</legend>
        {people.map((p) => (
          <label key={p.id} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              disabled={busy}
              onChange={(e) =>
                setIds((prev) =>
                  e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id),
                )
              }
            />{' '}
            {memberName(p, '')}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field-label">{s.due}</span>
        <input
          type="date"
          required
          value={day}
          min={today}
          max={maxDay}
          disabled={busy}
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">{s.photoLabel}</span>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy || files.length >= MAX_TASK_PHOTOS}
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])].map((file) => ({
              key: crypto.randomUUID(),
              file,
            }));
            setFiles((prev) => [...prev, ...picked].slice(0, MAX_TASK_PHOTOS));
            e.target.value = '';
          }}
        />
      </label>
      {files.map((f) => (
        <div key={f.key} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span>{f.file.name}</span>
          <button
            type="button"
            className="btn soft"
            disabled={busy}
            onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}
          >
            {s.removePhoto}
          </button>
        </div>
      ))}
      {problem ? <p role="alert">{problem}</p> : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn brand" disabled={busy}>
          {s.save}
        </button>
        <button type="button" className="btn soft" disabled={busy} onClick={onClose}>
          {s.cancel}
        </button>
      </div>
    </form>
  );
}
