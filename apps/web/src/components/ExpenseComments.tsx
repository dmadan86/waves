'use client';

/**
 * The conversation on one expense (A46).
 *
 * "Why is this ₹4,800?" is the question a shared ledger exists to settle, and
 * until now the browser could not answer it — the thread was on the phone only,
 * so half a group could see a discussion the other half could not.
 *
 * Three things worth knowing about the shape of this:
 *
 * **It loads its own comments.** Not because that is tidier, but because a
 * failed comment read must not take the expense down with it. The group screen
 * learned that the hard way: one `Promise.all` turned a failed activity query
 * into "not your group".
 *
 * **The server decides who may do what**, not this file. Any member may add and
 * flag; an author may edit or delete their own; an admin may delete any. The
 * buttons here follow those rules so nobody is offered an action that will be
 * refused, but they are a courtesy — the RPC is what enforces it.
 *
 * **A comment posts optimistically.** Text should feel instant, and the id is
 * the caller's to choose, so a retry of the same post returns the same row
 * rather than a second copy of it. If the write fails the echo is taken back
 * and the text goes back into the composer, rather than vanishing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, MessageSquare, Pencil, Trash2 } from 'lucide-react';

import { MAX_COMMENT_LENGTH, sanitizeCommentMarkdown } from '@waves/core';
import { nameOf, type ExpenseComment, type Member } from '@waves/api-client';

import { CommentMarkdown } from '@/components/CommentMarkdown';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

/** Below this many characters left, the counter is worth showing. */
const COUNTER_FROM = 200;

export function ExpenseComments({
  groupId,
  expenseId,
  members,
  myMemberId,
  canModerate,
}: {
  groupId: string;
  expenseId: string;
  members: Member[];
  /** The reader's membership in this group, if they have one. */
  myMemberId: string | null;
  /** An admin may delete anybody's comment. */
  canModerate: boolean;
}) {
  const { t, locale } = useStrings();

  const [comments, setComments] = useState<ExpenseComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const composer = useRef<HTMLTextAreaElement>(null);

  // Every refresh takes a ticket. Actions stay live while a request is in
  // flight, so two can overlap — and the one that *started* first can finish
  // last, putting its older snapshot over the newer one and making a just-made
  // edit look like it did not take. Only the newest ticket may write.
  const ticket = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++ticket.current;
    const rows = await waves.expenseComments(expenseId);
    if (mine === ticket.current) setComments(rows);
  }, [expenseId]);

  useEffect(() => {
    let active = true;
    // The read is written out here rather than calling `refresh`, so every
    // state change lands in a callback — `refresh` is the same request for the
    // event handlers, where a synchronous setState is nobody's problem.
    const mine = ++ticket.current;
    void waves
      .expenseComments(expenseId)
      .then((rows) => {
        if (active && mine === ticket.current) setComments(rows);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [expenseId]);

  const byMember = new Map(members.map((member) => [member.id, member]));
  const timeFormat = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  async function post() {
    const body = sanitizeCommentMarkdown(draft);
    if (body === '' || posting) return;

    // The id is chosen here so a retry is the same write, not a second comment.
    const commentId = crypto.randomUUID();
    const echo: ExpenseComment = {
      id: commentId,
      group_id: groupId,
      expense_id: expenseId,
      author_member_id: myMemberId,
      body,
      edited_at: null,
      flagged_at: null,
      flagged_by: null,
      created_at: new Date().toISOString(),
    };

    setPosting(true);
    setError(null);
    setDraft('');
    setComments((current) => [...(current ?? []), echo]);

    try {
      await waves.addExpenseComment({ groupId, expenseId, commentId, body });
    } catch (caught) {
      // The write itself failed. Take the echo back and hand the text to the
      // composer, so a failed post costs a retry and not the writing.
      setComments((current) => (current ?? []).filter((row) => row.id !== commentId));
      setDraft(body);
      setError(
        friendlyError(caught, 'web.comments.post', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
      setPosting(false);
      return;
    }

    // Past this line the comment exists on the server, so the refresh below is
    // not allowed to undo any of it. Rolling back here would put the text back
    // in the composer for a comment that posted — and the retry would mint a
    // *new* id, which the server cannot recognise as the same request, so it
    // would post a second copy. A refresh that fails leaves the optimistic echo
    // standing; it is the right row, and the next read replaces it.
    setPosting(false);
    await refresh().catch(() => undefined);
  }

  /**
   * Run one write, then re-read. The two are separate on purpose: only the
   * write's own failure is the action failing, and a refresh that cannot reach
   * the server afterwards must not be reported as "could not save" for
   * something that saved.
   */
  async function act(what: () => Promise<unknown>, where: string) {
    setError(null);
    try {
      await what();
    } catch (caught) {
      setError(
        friendlyError(caught, where, {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
      return;
    }
    await refresh().catch(() => undefined);
  }

  const left = MAX_COMMENT_LENGTH - draft.length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t.comments.title}</h2>
      </div>

      {failed ? (
        <EmptyState Icon={MessageSquare} title={t.errors.couldNotLoad} />
      ) : comments === null ? (
        <SkeletonRows rows={3} amount={false} />
      ) : comments.length === 0 ? (
        <EmptyState Icon={MessageSquare} title={t.comments.emptyTitle} body={t.comments.empty} />
      ) : (
        <ol className="comments">
          {comments.map((comment) => {
            const author = comment.author_member_id
              ? byMember.get(comment.author_member_id)
              : undefined;
            const mine =
              comment.author_member_id !== null && comment.author_member_id === myMemberId;
            const editing = editingId === comment.id;

            return (
              <li key={comment.id} className={`comment${comment.flagged_at ? ' is-flagged' : ''}`}>
                <div className="comment-head">
                  <span className="comment-who">
                    {mine ? t.comments.you : author ? nameOf(author) : ''}
                  </span>
                  {comment.created_at ? (
                    <time className="comment-when" dateTime={comment.created_at}>
                      {timeFormat.format(new Date(comment.created_at))}
                    </time>
                  ) : null}
                  {comment.edited_at ? (
                    <span className="comment-when">· {t.comments.edited}</span>
                  ) : null}
                  {comment.flagged_at ? (
                    <span className="pill-badge warn">{t.comments.reported}</span>
                  ) : null}
                </div>

                {editing ? (
                  <div className="comment-edit">
                    <textarea
                      className="textarea"
                      value={editDraft}
                      maxLength={MAX_COMMENT_LENGTH}
                      aria-label={t.comments.edit}
                      onChange={(event) => setEditDraft(event.target.value)}
                    />
                    <div className="comment-actions">
                      <button
                        type="button"
                        className="btn"
                        // An edit that sanitises to nothing is not an edit. The
                        // server would refuse it, and the client refuses it
                        // first so the button never looks like it worked.
                        disabled={sanitizeCommentMarkdown(editDraft) === ''}
                        onClick={() =>
                          void act(async () => {
                            const saved = await waves.editExpenseComment(comment.id, editDraft);
                            // Only leave the editor when something was written.
                            // Closing regardless re-showed the unchanged comment
                            // and said nothing about why.
                            if (saved) setEditingId(null);
                          }, 'web.comments.edit')
                        }
                      >
                        {t.comments.save}
                      </button>
                      <button type="button" className="btn soft" onClick={() => setEditingId(null)}>
                        {t.comments.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <CommentMarkdown source={comment.body} />
                )}

                {editing ? null : (
                  <div className="comment-actions">
                    {mine ? (
                      <button
                        type="button"
                        className="linklike"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditDraft(comment.body);
                        }}
                      >
                        <Pencil size={13} strokeWidth={2} aria-hidden /> {t.comments.edit}
                      </button>
                    ) : null}

                    {mine || canModerate ? (
                      confirmDelete === comment.id ? (
                        <>
                          <span className="comment-when">{t.comments.deleteConfirm}</span>
                          <button
                            type="button"
                            className="linklike danger"
                            onClick={() =>
                              void act(async () => {
                                await waves.deleteExpenseComment(comment.id);
                                setConfirmDelete(null);
                              }, 'web.comments.delete')
                            }
                          >
                            {t.comments.delete}
                          </button>
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => setConfirmDelete(null)}
                          >
                            {t.comments.cancel}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => setConfirmDelete(comment.id)}
                        >
                          <Trash2 size={13} strokeWidth={2} aria-hidden /> {t.comments.delete}
                        </button>
                      )
                    ) : null}

                    {/* Flagging is any member's, including on their own comment
                        — the point is to raise it, not to accuse somebody. */}
                    <button
                      type="button"
                      className="linklike"
                      aria-pressed={Boolean(comment.flagged_at)}
                      onClick={() =>
                        void act(
                          () => waves.flagExpenseComment(comment.id, !comment.flagged_at),
                          'web.comments.flag',
                        )
                      }
                    >
                      <Flag size={13} strokeWidth={2} aria-hidden />{' '}
                      {comment.flagged_at ? t.comments.resolve : t.comments.report}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {error ? <p className="error">{error}</p> : null}

      {/* A guest who is not a member of this group can read the thread but has
          nothing to post with, so the composer is not drawn for them. */}
      {myMemberId ? (
        <div className="composer">
          <textarea
            ref={composer}
            className="textarea"
            value={draft}
            maxLength={MAX_COMMENT_LENGTH}
            placeholder={t.comments.placeholder}
            aria-label={t.comments.placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter is a newline; the modifier posts. A thread where Enter
              // sends is a thread full of half-written sentences.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void post();
              }
            }}
          />
          <div className="composer-foot">
            {left <= COUNTER_FROM ? (
              <span className="comment-when">{fill(t.comments.remaining, { count: left })}</span>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="btn brand"
              disabled={posting || sanitizeCommentMarkdown(draft) === ''}
              onClick={() => void post()}
            >
              {posting ? t.comments.posting : t.comments.post}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
