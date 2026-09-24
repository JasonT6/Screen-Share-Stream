import { MonitorPlay, Users } from "lucide-react";
import type { StreamSessionState } from "./useStreamSession";

type ParticipantsListProps = Pick<
  StreamSessionState,
  "participants" | "selectedId" | "setSelected" | "ownId"
>;

export default function ParticipantsList({
  participants,
  selectedId,
  setSelected,
  ownId
}: ParticipantsListProps) {
  return (
    <>
      <div className="viewers-heading">
        <span>
          <Users size={17} />
          Participants
        </span>
        <span>{participants.length}</span>
      </div>
      <ul className="viewer-list">
        {participants.map((participant) => (
          <li key={participant.id}>
            <button
              type="button"
              className="participant-stream"
              disabled={!participant.streamId}
              aria-pressed={selectedId === participant.id}
              aria-label={`${participant.streamId ? "Watch" : "Not sharing:"} ${participant.username}`}
              onClick={() => setSelected(participant.id)}
            >
              <span className="avatar">
                {participant.streamId ? (
                  <MonitorPlay size={16} />
                ) : (
                  <Users size={16} />
                )}
              </span>
              <span className="participant-name">
                {participant.username}
                {participant.id === ownId ? " (you)" : ""}
              </span>
              <small>
                {participant.streamId
                  ? selectedId === participant.id
                    ? "Viewing"
                    : "Live"
                  : "Not sharing"}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
