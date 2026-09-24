import { Headphones, ScreenShare } from "lucide-react";
import type { FrameRate } from "@/lib/media";
import QualitySelector from "./QualitySelector";
import { PasswordField, Problem } from "./SessionFields";
import type { StreamSessionState } from "./useStreamSession";

type SessionEntryFormProps = Pick<
  StreamSessionState,
  | "enter"
  | "username"
  | "setUsername"
  | "password"
  | "setPassword"
  | "busy"
  | "publishQuality"
  | "changePublishQuality"
  | "publishPreferences"
  | "frameRate"
  | "setFrameRate"
  | "error"
  | "leave"
> & { roomId: string | null };

export default function SessionEntryForm({
  roomId,
  enter,
  username,
  setUsername,
  password,
  setPassword,
  busy,
  publishQuality,
  changePublishQuality,
  publishPreferences,
  frameRate,
  setFrameRate,
  error,
  leave
}: SessionEntryFormProps) {
  return (
    <form onSubmit={enter}>
      <div className="panel-icon">
        <ScreenShare size={22} />
      </div>
      <h2>{roomId ? "Join the stream" : "Start a stream"}</h2>
      <p className="muted">
        {roomId
          ? "Enter your username and the password from your host."
          : "Choose a username and password, then share a screen."}
      </p>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          maxLength={40}
          autoComplete="nickname"
          disabled={busy}
          placeholder="How others will see you"
        />
      </div>
      <PasswordField
        value={password}
        onChange={setPassword}
        create={!roomId}
        disabled={busy}
      />
      {!roomId && (
        <QualitySelector
          id="publish-quality"
          label="Stream quality"
          value={publishQuality}
          onChange={changePublishQuality}
          preferences={publishPreferences}
          onPreferences={(value) => changePublishQuality(publishQuality, value)}
          disabled={busy}
        >
          <div className="field">
            <label htmlFor="frame-rate">Frame Rate</label>
            <select
              id="frame-rate"
              value={frameRate}
              disabled={busy}
              onChange={(event) =>
                setFrameRate(Number(event.target.value) as FrameRate)
              }
            >
              <option value={60}>60 fps</option>
              <option value={30}>30 fps</option>
            </select>
          </div>
        </QualitySelector>
      )}
      {!roomId && (
        <div className="audio-tip">
          <Headphones size={19} />
          <p>
            <strong>Want to include audio?</strong>Share a browser tab and
            enable “Share tab audio”.
          </p>
        </div>
      )}
      <Problem>{error}</Problem>
      <button type="submit" className="button full" disabled={busy}>
        <ScreenShare size={18} />
        {busy
          ? "Connecting…"
          : roomId
            ? error
              ? "Try again"
              : "Connect to stream"
            : "Share screen"}
      </button>
      {busy && (
        <button type="button" className="text-button full" onClick={leave}>
          Cancel
        </button>
      )}
    </form>
  );
}
