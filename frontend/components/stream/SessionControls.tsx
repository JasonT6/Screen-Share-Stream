import { ArrowLeft, Check, Copy, ScreenShare } from "lucide-react";
import { PasswordField, Problem } from "./SessionFields";
import ParticipantsList from "./ParticipantsList";
import QualitySelector from "./QualitySelector";
import NetworkStatus from "./NetworkStatus";
import type { StreamSessionState } from "./useStreamSession";

type SessionControlsProps = Pick<
  StreamSessionState,
  | "username"
  | "link"
  | "copy"
  | "copied"
  | "password"
  | "setPassword"
  | "participants"
  | "selectedId"
  | "setSelected"
  | "ownId"
  | "publishQuality"
  | "changePublishQuality"
  | "publishPreferences"
  | "ownStream"
  | "ownHealth"
  | "notice"
  | "stopSharing"
  | "sharingBusy"
  | "share"
  | "cancelSharing"
  | "leave"
> & { roomId: string | null };

export default function SessionControls({
  roomId,
  username,
  link,
  copy,
  copied,
  password,
  setPassword,
  participants,
  selectedId,
  setSelected,
  ownId,
  publishQuality,
  changePublishQuality,
  publishPreferences,
  ownStream,
  ownHealth,
  notice,
  stopSharing,
  sharingBusy,
  share,
  cancelSharing,
  leave
}: SessionControlsProps) {
  return (
    <>
      <h2>Your session</h2>
      <div className="connection-detail">
        <span className="dot" />
        Connected as {username.trim()}
      </div>
      {link && (
        <div className="field">
          <label htmlFor="invite-link">Private invitation</label>
          <input
            id="invite-link"
            value={link}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <button
            type="button"
            className="button full secondary"
            onClick={copy}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}
            {copied ? "Copied" : "Copy invitation link"}
          </button>
          <p className="field-help">Share the password separately.</p>
        </div>
      )}
      {link && (
        <PasswordField value={password} onChange={setPassword} disabled />
      )}
      <ParticipantsList
        participants={participants}
        selectedId={selectedId}
        setSelected={setSelected}
        ownId={ownId}
      />
      <QualitySelector
        id="publish-quality"
        label="Stream quality"
        value={publishQuality}
        onChange={changePublishQuality}
        preferences={publishPreferences}
        onPreferences={(value) => changePublishQuality(publishQuality, value)}
      />
      <p className="field-help">
        Your outgoing screen quality. Lower settings reduce upload use for every
        viewer.
      </p>
      {ownStream && <NetworkStatus label="Your upload" status={ownHealth} />}
      <Problem>{notice}</Problem>
      {ownStream &&
        !ownStream
          .getAudioTracks()
          .some((track) => track.readyState === "live") && (
          <p
            className="field-help"
            role="status"
            data-testid="audio-sharing-notice"
          >
            Audio isn’t being shared. To include it, stop sharing and enable
            audio in the screen share selector, if available.
          </p>
        )}
      {ownStream ? (
        <button className="button full secondary" onClick={stopSharing}>
          Stop sharing
        </button>
      ) : (
        <>
          <button
            className="button full"
            disabled={sharingBusy}
            onClick={share}
          >
            <ScreenShare size={18} />
            {sharingBusy ? "Starting…" : "Share screen"}
          </button>
          {sharingBusy && (
            <button className="text-button full" onClick={cancelSharing}>
              Cancel sharing
            </button>
          )}
          <p className="field-help">
            Share a tab, window, or screen. Audio is optional.
          </p>
        </>
      )}
      <button className="button full danger" onClick={leave}>
        <ArrowLeft size={17} />
        {roomId ? "Leave stream" : "End stream"}
      </button>
    </>
  );
}
