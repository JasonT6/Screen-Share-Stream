/* Full navigation deliberately tears down the active stream and its URL fragment. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { ROOM_PATTERN } from "@/lib/protocol";
import AdvancedDiagnostics from "./AdvancedDiagnostics";
import SessionEntryForm from "./SessionEntryForm";
import SessionControls from "./SessionControls";
import StreamStage from "./StreamStage";
import { useStreamSession } from "./useStreamSession";

export default function Session({ roomId }: { roomId: string | null }) {
  const state = useStreamSession(roomId);
  const { ended, ready, username, busy, diagnostics } = state;

  if (roomId && !ROOM_PATTERN.test(roomId))
    return (
      <div className="join-card">
        <LockKeyhole size={30} />
        <h1>This invitation isn’t valid.</h1>
        <p>Ask the host for the complete invitation link.</p>
        <a className="button secondary" href="/">
          Go to Private Stream
        </a>
      </div>
    );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR PEOPLE. YOUR SCREENS.</p>
          <h1>
            {ended
              ? "That’s a wrap."
              : ready
                ? "Together in the session."
                : "Good things are better shared."}
          </h1>
          <p>
            {ended
              ? "The host has ended this session."
              : "Share your screen and audio. Choose whose stream to watch."}
          </p>
        </div>
        <span className={`status-pill ${ready ? "live" : ""}`}>
          <span className="dot" />
          {ready
            ? `Joined as ${username.trim()}`
            : busy
              ? "Connecting…"
              : "Ready when you are"}
        </span>
      </div>
      <div className="workspace">
        <StreamStage roomId={roomId} {...state} />
        <aside className="side-panel">
          {!ready && !ended ? (
            <SessionEntryForm roomId={roomId} {...state} />
          ) : ended ? (
            <>
              <h2>Thanks for joining</h2>
              <p className="muted">Ask your host for a new invitation.</p>
              <a className="button secondary full" href="/">
                Back to Private Stream
              </a>
            </>
          ) : (
            <SessionControls roomId={roomId} {...state} />
          )}
          <div className="viewer-privacy">
            <ShieldCheck size={19} />
            <p>
              Anyone in the session can share their screen and source audio. No
              microphone or camera access is requested.
            </p>
          </div>
        </aside>
      </div>
      <AdvancedDiagnostics value={diagnostics} />
    </>
  );
}
