// VIEW-075 / GIT-030: the pull request's comments as cards in the Checks tab. Open threads, the
// plain conversation and resolved threads, or one chronological list; reactions; resolving; replies
// under the comment they answer; an Add comment button after the display options. Rust
// (pr_review.rs) reads and writes GitHub; review.ts decides what is shown.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { botToggle, relabelAsBot, toggleBotIn } from "../settings/reviewBots";
import { useSettings } from "../settings/useSettings";
import Markdown from "../tasks/MarkdownView";
import "./comments.css";
import "./scmUx.css";
import { emptyBook, rowBusy, rowDone, rowStart, replyBlock, type RowBook } from "./panelUx";
import {
  REACTION_CHOICES,
  REVIEW_BOTS_KEY,
  botNames,
  cardCount,
  cardGroups,
  cleanComment,
  emojiOf,
  moreNote,
  ownCall,
  placeOf,
  reactKind,
  reactionCall,
  relativeTime,
  repliable,
  reviewPrompt,
  sendsOnEnter,
  timeline,
  visibleReview,
  type Comment,
  type Review,
  type Thread,
} from "./review";

type Props = { dir: string; url: string; visible: boolean; extra?: (t: Thread) => ReactNode };
type Mode = "groups" | "time";

/** A box that sends on Enter (not while an input method composes), Shift+Enter for a new line. */
export function Composer({ label, send, cancel, initial }: { label: string; send: (text: string) => Promise<void>; cancel: () => void; initial?: string }) {
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const clean = cleanComment(text);
  const go = () => {
    if (clean === null || busy) return;
    setBusy(true);
    send(clean).then(
      () => setBusy(false),
      () => setBusy(false),
    );
  };
  return (
    <div className="cm-composer">
      <textarea
        autoFocus
        rows={3}
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (sendsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
            e.preventDefault();
            go();
          }
        }}
      />
      <div className="sb-hint cm-hint" data-composer-hint>
        Enter sends. Shift+Enter adds a new line.
      </div>
      <div className="cm-row">
        <button className="btn" disabled={clean === null || busy} onClick={go}>
          {busy ? "Sending…" : "Send"}
        </button>
        <button className="btn" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function CommentsPanel({ dir, url, visible, extra }: Props) {
  const { settings, save } = useSettings();
  const bots = botNames(settings?.[REVIEW_BOTS_KEY]);
  const botCell = useRef<{ current: readonly string[] }>({ current: bots });
  botCell.current.current = bots;
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("groups");
  const [hideBots, setHideBots] = useState(false);
  const [adding, setAdding] = useState(false);
  const [replying, setReplying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Which cards are mid-action, and the error each last stopped on, so a failure sits next to the card it came from.
  const [book, setBook] = useState<RowBook>(emptyBook);
  const [picking, setPicking] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // GIT-031: threads queued for the agent, and the ones just delivered (waiting for the one combined reply)
  const [queue, setQueue] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ terminal: string; ids: string[] } | null>(null);
  const asking = useRef("");
  asking.current = `${dir}|${url}`;

  const load = (botList: string[] = bots) => {
    const key = asking.current;
    setLoading(true);
    invoke<Review>("scm_review_read", { worktree: dir, url, bots: botList })
      .then((r) => {
        if (asking.current !== key) return;
        setReview(r);
        setError(null);
      })
      .catch((e) => asking.current === key && setError(String(e)))
      .finally(() => asking.current === key && setLoading(false));
  };
  useEffect(() => {
    setReview(null);
    setError(null);
    if (visible) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, url, visible]);

  /** One change on GitHub, then the comments are read again so the card shows what GitHub has. `row` is the card it belongs to: that card's buttons wait, and its error shows under it. */
  const act = (kind: string, id: string, text?: string, row: string = id): Promise<void> => {
    setNote(null);
    setBook((b) => rowStart(b, row));
    return invoke("scm_review_act", { worktree: dir, url, kind, id, text: text ?? null }).then(
      () => {
        setBook((b) => rowDone(b, row));
        load();
      },
      (e) => {
        setBook((b) => rowDone(b, row, String(e)));
        throw e;
      },
    );
  };
  const rowError = (row: string) => (book.errors[row] ? <div className="note error" role="alert" data-row-error={row}>{book.errors[row]}</div> : null);

  /** GIT-030: puts an author on (or takes one off) the bot list setting, then reads again so their cards sit apart. */
  const toggleBot = (author: string) => {
    const r = toggleBotIn(botCell.current, author);
    if (r.note) return setNote(r.note);
    setNote(null);
    // A mark relabels the cards here; taking one off needs the read, since GitHub's own bot flag is not on the card.
    void save({ [REVIEW_BOTS_KEY]: r.list }).then(() => (r.marked ? setReview((cur) => cur && relabelAsBot(cur, author)) : load(r.list)));
  };

  const queued = review ? review.threads.filter((t) => queue.includes(t.id) && !t.resolved) : [];
  const toggleQueue = (id: string) => setQueue((q) => (q.includes(id) ? q.filter((x) => x !== id) : [...q, id]));

  /** Sends the queued comments to the workspace's agent (the orchestration send). Nothing is marked done until it was submitted. */
  const sendQueued = () => {
    if (!queued.length || sending) return;
    setSending(true);
    setNote(null);
    invoke<{ terminal: string; receipt: string }>("scm_review_send", { worktree: dir, text: reviewPrompt(queued) })
      .then((r) => {
        setSent({ terminal: r.terminal, ids: queued.map((t) => t.id) });
        setQueue([]);
      })
      .catch((e) => setNote(String(e)))
      .finally(() => setSending(false));
  };

  /** One reply on every sent thread that can take one, then each is resolved. Stops at the first failure and says which. */
  const replyAndResolve = async (text: string) => {
    const mine = (review?.threads ?? []).filter((t) => sent?.ids.includes(t.id));
    for (const t of mine) {
      try {
        const first = t.comments[0]?.db_id;
        if (first != null) await invoke("scm_review_act", { worktree: dir, url, kind: "reply", id: String(first), text });
        await invoke("scm_review_act", { worktree: dir, url, kind: "resolve", id: t.id, text: null });
      } catch (e) {
        setNote(`Stopped at ${placeOf(t) || "a thread"}: ${String(e)}`);
        load();
        throw e;
      }
    }
    setSent(null);
    load();
  };

  const shown = review ? visibleReview(review, hideBots) : null;

  const reactions = (c: Comment, inThread: boolean) => (
    <div className="cm-reactions">
      {(c.reactions ?? []).map((r) => (
        <button
          key={r.content}
          className={`cm-react${r.mine ? " mine" : ""}`}
          title={r.mine ? "You reacted: press to take it back" : "React the same"}
          disabled={reactionCall(c, r, inThread) === null || rowBusy(book, c.id)}
          onClick={() => {
            const call = reactionCall(c, r, inThread);
            if (call) void act(call.kind, call.id, call.text, c.id).catch(() => {});
          }}
        >
          {emojiOf(r.content)} {r.count}
        </button>
      ))}
      <button className="cm-react add" aria-label="Add a reaction" title="Add a reaction" disabled={c.db_id === null || rowBusy(book, c.id)} onClick={() => setPicking(picking === c.id ? null : c.id)}>
        +
      </button>
      {picking === c.id && (
        <span className="cm-picker" role="menu">
          {REACTION_CHOICES.map((r) => (
            <button
              key={r.content}
              role="menuitem"
              title={r.label}
              aria-label={r.label}
              onClick={() => {
                setPicking(null);
                if (c.db_id !== null) void act(reactKind(inThread), String(c.db_id), r.content, c.id).catch(() => {});
              }}
            >
              {r.emoji}
            </button>
          ))}
        </span>
      )}
    </div>
  );

  const body = (c: Comment, inThread: boolean, reply?: boolean) => {
    const edit = ownCall(c, review?.viewer, inThread, "edit");
    const del = ownCall(c, review?.viewer, inThread, "delete");
    return (
    <div className={`cm-comment${reply ? " reply" : ""}${c.bot ? " bot" : ""}`} key={c.id}>
      <div className="cm-meta">
        <span className="cm-author">{c.author}</span>
        {c.bot && <span className="cm-tag">bot</span>}
        {botToggle(c.bot, c.author, bots) && (
          <button className="cm-link" title={botToggle(c.bot, c.author, bots) === "unmark" ? `Show ${c.author} as a person again` : `Treat ${c.author} as a bot (Settings > Git lists them)`} onClick={() => toggleBot(c.author)}>
            {botToggle(c.bot, c.author, bots) === "unmark" ? "Not a bot" : "Mark as bot"}
          </button>
        )}
        <span className="cm-time" title={c.at}>
          {relativeTime(c.at, Date.now())}
        </span>
      </div>
      {edit && editing === c.id ? (
        <Composer label="Edit this comment" initial={c.body} cancel={() => setEditing(null)} send={(text) => act(edit.kind, edit.id, text, c.id).then(() => setEditing(null))} />
      ) : (
        <div className="cm-body">
          <Markdown text={c.body} />
        </div>
      )}
      {reactions(c, inThread)}
      {edit && del && editing !== c.id && (
        <div className="cm-row">
          {deleting === c.id ? (
            <>
              <span className="sb-hint">Delete this comment from GitHub?</span>
              <button className="btn" disabled={rowBusy(book, c.id)} onClick={() => void act(del.kind, del.id, undefined, c.id).then(() => setDeleting(null), () => {})}>
                {rowBusy(book, c.id) ? "Deleting…" : "Delete"}
              </button>
              <button className="btn" disabled={rowBusy(book, c.id)} onClick={() => setDeleting(null)}>
                Keep
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setEditing(c.id)}>
                Edit
              </button>
              <button className="btn" onClick={() => setDeleting(c.id)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
      {rowError(c.id)}
    </div>
    );
  };

  const thread = (t: Thread) => {
    const noReply = replyBlock(t);
    return (
    <article className={`cm-card thread${t.resolved ? " resolved" : ""}`} key={t.id} data-thread={t.id}>
      {placeOf(t) && (
        <div className="cm-place" title={placeOf(t)}>
          {placeOf(t)}
        </div>
      )}
      {t.comments.map((c, i) => body(c, true, i > 0))}
      {moreNote(t.more) && <div className="sb-hint">{moreNote(t.more)}</div>}
      <div className="cm-row">
        {replying === t.id ? null : (
          <button className="btn" data-reply disabled={noReply !== null} title={noReply ?? "Reply to this thread"} onClick={() => setReplying(t.id)}>
            Reply
          </button>
        )}
        <button className="btn" disabled={rowBusy(book, t.id)} onClick={() => void act(t.resolved ? "unresolve" : "resolve", t.id).catch(() => {})}>
          {rowBusy(book, t.id) ? "Working…" : t.resolved ? "Reopen" : "Resolve"}
        </button>
        {!t.resolved && (
          <button className="btn" aria-pressed={queue.includes(t.id)} title="Collect this comment to send to the agent with others" onClick={() => toggleQueue(t.id)}>
            {queue.includes(t.id) ? "Queued" : "Queue for agent"}
          </button>
        )}
        {extra?.(t)}
      </div>
      {noReply && replying !== t.id && (
        <div className="sb-hint" data-reply-block>
          {noReply}
        </div>
      )}
      {rowError(t.id)}
      {replying === t.id && t.comments[0]?.db_id != null && (
        <Composer
          label="Reply to this thread"
          cancel={() => setReplying(null)}
          send={(text) => act("reply", String(t.comments[0].db_id), text, t.id).then(() => setReplying(null))}
        />
      )}
    </article>
    );
  };

  const talk = (c: Comment) => (
    <article className="cm-card" key={c.id}>
      {body(c, false)}
    </article>
  );

  const groups = shown ? cardGroups(shown) : null;
  const GROUP = (key: string, label: string, count: number, children: ReactNode) =>
    count === 0 ? null : (
      <section className={`cm-group ${key}`} data-group={key} key={key}>
        <h4 className="check-group-title">
          {label} <span className="count">{count}</span>
        </h4>
        {children}
      </section>
    );

  return (
    <section className="cm-panel" aria-label="Comments">
      <div className="sb-section cm-head">
        <span>Comments</span>
        {shown && <span className="count">{cardCount(shown)}</span>}
        <div className="cm-options">
          <button className="btn" aria-pressed={mode === "time"} onClick={() => setMode(mode === "time" ? "groups" : "time")} title="Switch between groups and one list by time">
            {mode === "time" ? "Grouped" : "By time"}
          </button>
          <button className="btn" aria-pressed={hideBots} onClick={() => setHideBots(!hideBots)} title="Hide comments from bots">
            {hideBots ? "Show bots" : "Hide bots"}
          </button>
          <button className="btn" onClick={() => load()} disabled={loading} title="Read the comments again">
            {loading ? "Reading…" : "Refresh"}
          </button>
          <button className="btn" onClick={() => setAdding(!adding)}>
            Add comment
          </button>
        </div>
      </div>
      {adding && <Composer label="Write a comment on the pull request" cancel={() => setAdding(false)} send={(text) => act("comment", "0", text, "add").then(() => setAdding(false))} />}
      {rowError("add")}
      {note && <div className="note error">{note}</div>}
      {queued.length > 0 && (
        <div className="cm-row cm-queue">
          <button className="btn" disabled={sending} onClick={sendQueued}>
            {sending ? "Sending…" : `Send ${queued.length} to agent`}
          </button>
          <button className="btn" disabled={sending} onClick={() => setQueue([])}>
            Clear queue
          </button>
        </div>
      )}
      {sent && (
        <div className="cm-queue">
          <div className="note">
            Sent {sent.ids.length} comment{sent.ids.length === 1 ? "" : "s"} to {sent.terminal}. When the agent is done, post one reply on those threads and resolve them
            {review && repliable(review.threads.filter((t) => sent.ids.includes(t.id))).length < sent.ids.length ? " (threads that cannot take a reply are only resolved)" : ""}.
          </div>
          <Composer label="Reply posted on each sent thread" cancel={() => setSent(null)} send={replyAndResolve} />
        </div>
      )}
      {error ? (
        <div className="note error">The comments could not be read: {error}</div>
      ) : !shown ? (
        <div className="sb-hint">{loading ? "Reading the comments…" : ""}</div>
      ) : cardCount(shown) === 0 ? (
        <div className="sb-hint">No comments on this pull request yet.</div>
      ) : mode === "time" ? (
        <div className="cm-list" data-mode="time">
          {timeline(shown).map(({ comment, path }) => (
            <article className="cm-card" key={comment.id}>
              {path && (
                <div className="cm-place" title={path}>
                  {path}
                </div>
              )}
              {body(comment, path !== null)}
            </article>
          ))}
        </div>
      ) : (
        <div className="cm-list" data-mode="groups">
          {GROUP("open", "Open", groups!.open.length, groups!.open.map(thread))}
          {GROUP("conversation", "Conversation", groups!.conversation.length, groups!.conversation.map(talk))}
          {GROUP("resolved", "Resolved", groups!.resolved.length, groups!.resolved.map(thread))}
          {moreNote(shown.talk_more) && <div className="sb-hint">{moreNote(shown.talk_more)}</div>}
        </div>
      )}
    </section>
  );
}
