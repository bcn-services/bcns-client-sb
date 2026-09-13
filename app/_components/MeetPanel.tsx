/**
 * MeetPanel.tsx — Google Meet / Note AI. Item D feeds `notes` from
 * messages_v1 (kind='meeting_note'); until then the panel renders its
 * not-connected state with the same chrome.
 */

import { formatDayLabel, isSafeHttpsUrl } from "@/lib/overview";
import { noteExcerpt, sortRecentNotes, type NoteLike, type PanelState } from "@/lib/panels";
import { EXTERNAL_LINK_PROPS, SERVICE_LINKS } from "@/lib/links";
import { MeetIcon, NoteIcon } from "./icons";
import { Panel, PanelHead, StateNote, ViewAll } from "./Panel";

function NoteCard({ note }: { note: NoteLike }) {
  const body = (
    <>
      <span className="note-card__icon">
        <NoteIcon />
      </span>
      <span className="note-card__body">
        <span className="note-card__title">{note.title ?? "Meeting note"}</span>
        <span className="note-card__date">{note.occurred_at ? formatDayLabel(note.occurred_at) : "—"}</span>
        <span className="note-card__excerpt">{noteExcerpt(note.body)}</span>
      </span>
    </>
  );
  if (isSafeHttpsUrl(note.url)) {
    return (
      <a className="note-card note-card--link" href={note.url as string} {...EXTERNAL_LINK_PROPS}>
        {body}
      </a>
    );
  }
  return <div className="note-card">{body}</div>;
}

export function MeetPanel({ state, notes, connectHref }: { state: PanelState; notes: NoteLike[]; connectHref: string }) {
  return (
    <Panel className="panel--column">
      <PanelHead
        tile={<MeetIcon />}
        title="Google Meet / Note AI"
        small
        right={
          <a className="btn-accent btn-accent--sm" href={SERVICE_LINKS.googleMeet} {...EXTERNAL_LINK_PROPS}>
            Join Meeting
          </a>
        }
      />
      <div className="subhead">
        <span className="subhead__title">Recent Meeting Notes</span>
        <ViewAll href={SERVICE_LINKS.googleMeet} external />
      </div>
      {state === "data" ? (
        <div className="note-list">
          {sortRecentNotes(notes).map((note, i) => (
            <NoteCard key={note.id ?? `${note.occurred_at ?? ""}-${i}`} note={note} />
          ))}
        </div>
      ) : (
        <StateNote state={state} label="Google Meet" connectHref={connectHref} />
      )}
    </Panel>
  );
}
