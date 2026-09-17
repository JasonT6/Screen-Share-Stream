"use client";

/* Full navigation deliberately tears down the active stream and its URL fragment. */
/* eslint-disable @next/next/no-html-link-for-pages */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Headphones,
  LockKeyhole,
  MonitorPlay,
  ScreenShare,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
  Activity,
  Volume2
} from "lucide-react";
import {
  browserError,
  QUALITY_PRESETS,
  VIDEO_PRIORITIES,
  AUDIO_QUALITIES,
  PUBLISH_PREFERENCES,
  PLAYBACK_PREFERENCES,
  type StreamPreferences,
  type StreamQuality,
  captureDisplay,
  type FrameRate,
  type StreamStats
} from "@/lib/media";
import {
  passwordError,
  usernameError,
  randomHex,
  ROOM_PATTERN
} from "@/lib/protocol";
import {
  HostSession,
  ViewerSession,
  type RoomSession,
  type SessionEvents,
  type Participant
} from "@/lib/stream-session";

import {
  emptyMeasurements,
  summarizeUpload,
  uploadStatus,
  playbackStatus,
  unknownStatus,
  type ConnectionStatus
} from "@/lib/connection-quality";

function QualitySelector({
  id,
  label,
  value,
  onChange,
  disabled,
  preferences,
  onPreferences
}: {
  preferences: StreamPreferences;
  onPreferences: (value: StreamPreferences) => void;
  id: string;
  label: string;
  value: StreamQuality;
  onChange: (value: StreamQuality) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="field quality-selector">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as StreamQuality)}
        >
          {Object.entries(QUALITY_PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <details className="advanced-settings">
        <summary>
          Advanced {id === "playback-quality" ? "playback" : "stream"} settings
        </summary>
        <div className="field">
          <label htmlFor={`${id}-priority`}>Video priority</label>
          <select
            id={`${id}-priority`}
            value={preferences.priority}
            disabled={disabled}
            onChange={(event) =>
              onPreferences({
                ...preferences,
                priority: event.target.value as StreamPreferences["priority"]
              })
            }
          >
            {id === "playback-quality" && (
              <option value="streamer">Follow streamer</option>
            )}
            {Object.entries(VIDEO_PRIORITIES).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
          <p className="field-help">
            When bandwidth is limited, favor sharper detail, smoother motion, or
            a balance of both. Source and quality limits still apply.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-audio`}>Audio quality</label>
          <select
            id={`${id}-audio`}
            value={preferences.audio}
            disabled={disabled}
            onChange={(event) =>
              onPreferences({
                ...preferences,
                audio: event.target.value as StreamPreferences["audio"]
              })
            }
          >
            {Object.entries(AUDIO_QUALITIES).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
          <p className="field-help">
            Higher quality allows more audio detail; lower quality uses less
            data. Actual bitrate depends on the source and browser.
          </p>
        </div>
        <p className="field-help">
          {id === "playback-quality"
            ? "Applies only to streams you receive. Video priority overrides the streamer’s preference for your connection; audio quality cannot exceed the streamer’s limit."
            : "Applies to your outgoing stream, including future viewers. Viewers can choose their own video priority and lower audio quality."}{" "}
          Changes apply live.
        </p>
      </details>
    </>
  );
}

function NetworkStatus({
  label,
  status
}: {
  label: string;
  status: ConnectionStatus;
}) {
  const Icon =
    status.level === "poor"
      ? WifiOff
      : status.level === "unknown"
        ? Activity
        : Wifi;
  return (
    <details className={`network-status network-${status.level}`}>
      <summary aria-label={`${label}: ${status.label}`}>
        <Icon size={17} aria-hidden="true" />
        <span>
          <strong>{label}</strong>
          <span>{status.label}</span>
        </span>
      </summary>
      <p>{status.detail}</p>
    </details>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return children ? (
    <div className="problem" role="alert">
      {children}
    </div>
  ) : null;
}

function PasswordField({
  value,
  onChange,
  disabled,
  create = false
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  create?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor="stream-password">
        {create ? "Stream password" : "Password"}
      </label>
      <div className="password-input">
        <LockKeyhole size={17} aria-hidden="true" />
        <input
          id="stream-password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={create ? "new-password" : "current-password"}
          placeholder={
            create ? "Choose a password" : "Enter the password from your host"
          }
          required
          disabled={disabled}
          spellCheck={false}
        />
        <button
          className="icon-button"
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {create && (
        <button
          className="text-button"
          type="button"
          disabled={disabled}
          onClick={() => onChange(randomHex(10))}
        >
          Generate a strong password
        </button>
      )}
    </div>
  );
}

function Player({
  stream,
  preview = false
}: {
  stream: MediaStream | null;
  preview?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    setBlocked(false);
    if (stream) void element.play().catch(() => setBlocked(!preview));
    return () => {
      element.srcObject = null;
    };
  }, [stream, preview]);
  return (
    <div className={`player ${stream ? "has-stream" : ""}`}>
      <video
        ref={video}
        autoPlay
        playsInline
        muted={preview}
        controls={!preview && !!stream}
        aria-label={preview ? "Your stream preview" : "Live stream"}
      />
      {!stream && (
        <div className="player-placeholder">
          <div className="screen-symbol">
            <MonitorPlay size={42} strokeWidth={1.4} />
          </div>
          <h2>
            {preview
              ? "Your screen takes center stage."
              : "A front-row seat, from anywhere."}
          </h2>
          <p>
            {preview
              ? "Share a tab, window, or screen—with its audio."
              : "Choose an active stream from the participant list."}
          </p>
        </div>
      )}
      {preview && stream && (
        <span className="preview-label">YOUR PREVIEW · MUTED</span>
      )}
      {blocked && stream && (
        <button
          className="button play-overlay"
          onClick={() => {
            const element = video.current;
            if (element) {
              element.muted = false;
              void element
                .play()
                .then(() => setBlocked(false))
                .catch(() => setBlocked(true));
            }
          }}
        >
          <Volume2 size={19} /> Play with sound
        </button>
      )}
    </div>
  );
}

function Quality({
  stats,
  source
}: {
  stats: StreamStats | null;
  source?: MediaStream | null;
}) {
  const capture = source?.getVideoTracks()[0]?.getSettings();
  const width = stats?.width || capture?.width;
  const height = stats?.height || capture?.height;
  const fps = stats?.fps ?? capture?.frameRate;
  return (
    <div className="quality-strip">
      <span>
        <span className="dot" />{" "}
        {width && height ? `${width} × ${height}` : "Source resolution"}
      </span>
      <span>{fps ? `${Math.round(fps)} fps` : "Up to 60 fps"}</span>
      <span>
        <Headphones size={14} />{" "}
        {stats?.audio
          ? "Audio flowing"
          : source
            ? "Audio captured"
            : "Shared audio"}
      </span>
      {stats?.mbps !== undefined && <span>{stats.mbps.toFixed(1)} Mbps</span>}
    </div>
  );
}

function Session({ roomId }: { roomId: string | null }) {
  const session = useRef<RoomSession | null>(null);
  const capture = useRef<MediaStream | null>(null);
  const attempt = useRef(0);
  const shareAttempt = useRef(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [publishQuality, setPublishQuality] = useState<StreamQuality>("source");
  const [playbackQuality, setPlaybackQuality] =
    useState<StreamQuality>("source");
  const [publishPreferences, setPublishPreferences] =
    useState(PUBLISH_PREFERENCES);
  const [playbackPreferences, setPlaybackPreferences] =
    useState(PLAYBACK_PREFERENCES);
  const [measurements, setMeasurements] = useState(emptyMeasurements);
  const [frameRate, setFrameRate] = useState<FrameRate>(60);
  const [busy, setBusy] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [ended, setEnded] = useState(false);
  const [link, setLink] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const active = participants.filter((p) => p.streamId);
  const selectedId = active.some((p) => p.id === selected)
    ? selected
    : active[0]?.id;
  const selectedParticipant = participants.find((p) => p.id === selectedId);
  const stream = selectedId ? streams[selectedId] ?? null : null;
  const [ownId, setOwnId] = useState<string | null>(null);
  const ownStream = ownId ? streams[ownId] : null;
  const stats =
    selectedId === ownId
      ? measurements.outgoing[0] ?? null
      : selectedId
        ? measurements.incoming[selectedId] ?? null
        : null;
  const ownHealth = uploadStatus(summarizeUpload(measurements.outgoing));
  const remoteHealth = selectedId
    ? measurements.senders[selectedId]
    : undefined;
  const receiveHealth = playbackStatus(
    stats ?? undefined,
    Object.values(measurements.incoming),
    remoteHealth
  );

  const leave = useCallback(() => {
    attempt.current++;
    shareAttempt.current++;
    capture.current?.getTracks().forEach((track) => track.stop());
    capture.current = null;
    session.current?.close();
    session.current = null;
    setOwnId(null);
    setMeasurements(emptyMeasurements());
    setStreams({});
    setParticipants([]);
    setSelected(null);
    setReady(false);
    setBusy(false);
    setSharingBusy(false);
    setLink("");
    setNotice("");
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        capture.current
          ?.getTracks()
          .some((track) => track.readyState === "live")
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", beforeUnload);
      leave();
    };
  }, [leave]);

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let polling = false;
    const timer = setInterval(() => {
      const current = session.current;
      if (!current || polling) return;
      polling = true;
      void current
        .measurements()
        .then((value) => {
          if (!disposed && current === session.current) setMeasurements(value);
        })
        .catch(() => {
          if (!disposed) setMeasurements(emptyMeasurements());
        })
        .finally(() => {
          polling = false;
        });
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [ready]);

  function changePublishQuality(
    value: StreamQuality,
    preferences = publishPreferences
  ) {
    setPublishQuality(value);
    setPublishPreferences(preferences);
    void session.current
      ?.setPublishQuality(value, preferences)
      .catch(() =>
        setNotice("Stream settings could not be updated. Please try again.")
      );
  }
  function changePlaybackQuality(
    value: StreamQuality,
    preferences = playbackPreferences
  ) {
    setPlaybackQuality(value);
    setPlaybackPreferences(preferences);
    void session.current
      ?.setPlaybackQuality(value, preferences)
      .catch(() =>
        setNotice("Playback settings could not be updated. Please try again.")
      );
  }

  function eventsFor(generation: number): SessionEvents {
    const current = () => attempt.current === generation;
    return {
      participants: (value) => {
        if (current()) setParticipants(value);
      },
      stream: (id, value) => {
        if (!current()) return;
        const local = id === session.current?.id;
        setMeasurements((previous) => {
          const incoming = { ...previous.incoming };
          const senders = { ...previous.senders };
          delete incoming[id];
          delete senders[id];
          return {
            incoming,
            senders,
            outgoing: local ? [] : previous.outgoing
          };
        });
        setStreams((previous) => {
          const next = { ...previous };
          if (value) next[id] = value;
          else delete next[id];
          return next;
        });
      },
      notice: (value) => {
        if (current()) setNotice(value);
      },
      ready: () => {
        if (current() && roomId) {
          setReady(true);
          setBusy(false);
        }
      },
      error: (value) => {
        if (current()) {
          leave();
          setError(value);
        }
      },
      ended: () => {
        if (current()) {
          leave();
          setEnded(true);
        }
      }
    };
  }

  async function enter(event: FormEvent) {
    event.preventDefault();
    const issue =
      usernameError(username) ||
      passwordError(password) ||
      browserError(!roomId);
    if (issue) {
      setError(issue);
      return;
    }
    const generation = ++attempt.current;
    setBusy(true);
    setError("");
    setNotice("");
    setEnded(false);
    let source: MediaStream | undefined;
    try {
      let joined: RoomSession;
      if (roomId) {
        joined = await ViewerSession.join(
          roomId,
          password,
          username,
          eventsFor(generation)
        );
      } else {
        // Capture must remain directly in the user's gesture, before crypto/network awaits.
        source = await captureDisplay(frameRate);
        if (attempt.current !== generation) {
          source.getTracks().forEach((track) => track.stop());
          return;
        }
        capture.current = source;
        joined = await HostSession.start(
          password,
          username,
          source,
          eventsFor(generation),
          publishQuality
        );
      }
      if (attempt.current !== generation) {
        joined.close();
        return;
      }
      session.current = joined;
      await joined.setPublishQuality(publishQuality, publishPreferences);
      await joined.setPlaybackQuality(playbackQuality, playbackPreferences);
      if (attempt.current !== generation) {
        joined.close();
        return;
      }
      setOwnId(joined.id);
      if (joined instanceof HostSession) {
        setReady(true);
        setBusy(false);
        const invitation = new URL(window.location.href);
        invitation.search = "";
        invitation.hash = `room=${joined.roomId}`;
        setLink(invitation.href);
      }
    } catch (failure) {
      source?.getTracks().forEach((track) => track.stop());
      if (attempt.current !== generation) return;
      leave();
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not join the session."
      );
    }
  }

  async function share() {
    const current = session.current;
    if (!current || !ready) return;
    const issue = browserError(true);
    if (issue) {
      setNotice(issue);
      return;
    }
    const generation = ++shareAttempt.current;
    setSharingBusy(true);
    setNotice("");
    let source: MediaStream | undefined;
    try {
      source = await captureDisplay(frameRate);
      if (shareAttempt.current !== generation || session.current !== current) {
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      capture.current = source;
      await current.startSharing(source);
    } catch (failure) {
      source?.getTracks().forEach((track) => track.stop());
      if (shareAttempt.current === generation)
        setNotice(
          failure instanceof Error
            ? failure.message
            : "Screen sharing could not start."
        );
    } finally {
      if (shareAttempt.current === generation) setSharingBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Copy the invitation from the link field.");
    }
  }

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
        <section className="stage">
          <div className="stage-heading">
            <span>
              <MonitorPlay size={18} />
              {selectedParticipant
                ? `${selectedParticipant.username}’s stream`
                : "Live streams"}
            </span>
            <span className="small-label">DIRECT · PRIVATE</span>
          </div>
          <Player
            stream={stream}
            preview={selectedId === ownId || (!ready && !roomId)}
          />
          <Quality
            source={selectedId === ownId ? stream : null}
            stats={stats}
          />
          {ready && selectedId && selectedId !== ownId && (
            <div className="playback-settings">
              <QualitySelector
                id="playback-quality"
                label="Playback quality"
                value={playbackQuality}
                onChange={changePlaybackQuality}
                preferences={playbackPreferences}
                onPreferences={(value) =>
                  changePlaybackQuality(playbackQuality, value)
                }
              />
              <p className="field-help">
                Applies to streams you receive. The streamer’s quality sets the
                upper limit.
              </p>
              <div className="network-row">
                <NetworkStatus label="Your connection" status={receiveHealth} />
                <NetworkStatus
                  label="Streamer’s upload"
                  status={
                    remoteHealth
                      ? uploadStatus(remoteHealth.summary)
                      : unknownStatus("Awaiting streamer stats")
                  }
                />
              </div>
              <p className="field-help">
                Connection estimates from live streams. Click an icon for
                details.
              </p>
            </div>
          )}
          <div className="stage-note">
            <Headphones size={17} />
            <span>
              {ready
                ? "Click a participant’s active stream to watch. Only the selected stream plays audio."
                : "Screen video and shared audio travel directly between participants."}
            </span>
          </div>
        </section>
        <aside className="side-panel">
          {!ready && !ended ? (
            <form onSubmit={enter}>
              <div className="panel-icon">
                <ScreenShare size={22} />
              </div>
              <h2>{roomId ? "Join the stream" : "Start a stream"}</h2>
              <p className="muted">
                {roomId
                  ? "Enter your username and the password from your host."
                  : "Choose a username and password, then share a screen with audio."}
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
                  onPreferences={(value) =>
                    changePublishQuality(publishQuality, value)
                  }
                  disabled={busy}
                />
              )}
              {!roomId && (
                <div className="field">
                  <label htmlFor="frame-rate">Motion quality</label>
                  <select
                    id="frame-rate"
                    value={frameRate}
                    disabled={busy}
                    onChange={(event) =>
                      setFrameRate(Number(event.target.value) as FrameRate)
                    }
                  >
                    <option value={60}>Source resolution · 60 fps</option>
                    <option value={30}>Source resolution · 30 fps</option>
                  </select>
                </div>
              )}
              {!roomId && (
                <div className="audio-tip">
                  <Headphones size={19} />
                  <p>
                    <strong>Remember to share audio.</strong>Share a browser tab
                    and enable “Share tab audio”.
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
                    : "Share screen & audio"}
              </button>
              {busy && (
                <button
                  type="button"
                  className="text-button full"
                  onClick={leave}
                >
                  Cancel
                </button>
              )}
            </form>
          ) : ended ? (
            <>
              <h2>Thanks for joining</h2>
              <p className="muted">Ask your host for a new invitation.</p>
              <a className="button secondary full" href="/">
                Back to Private Stream
              </a>
            </>
          ) : (
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
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  disabled
                />
              )}
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
              <QualitySelector
                id="publish-quality"
                label="Stream quality"
                value={publishQuality}
                onChange={changePublishQuality}
                preferences={publishPreferences}
                onPreferences={(value) =>
                  changePublishQuality(publishQuality, value)
                }
              />
              <p className="field-help">
                Your outgoing screen quality. Lower settings reduce upload use
                for every viewer.
              </p>
              {ownStream && (
                <NetworkStatus label="Your upload" status={ownHealth} />
              )}
              <Problem>{notice}</Problem>
              {ownStream ? (
                <button
                  className="button full secondary"
                  onClick={() => {
                    void session.current
                      ?.stopSharing()
                      .catch((failure) => setNotice(failure.message));
                  }}
                >
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
                    {sharingBusy ? "Starting…" : "Share screen & audio"}
                  </button>
                  {sharingBusy && (
                    <button
                      className="text-button full"
                      onClick={() => {
                        shareAttempt.current++;
                        setSharingBusy(false);
                      }}
                    >
                      Cancel sharing
                    </button>
                  )}
                  <p className="field-help">
                    Share a tab, window, or screen with source audio.
                  </p>
                </>
              )}
              <button className="button full danger" onClick={leave}>
                <ArrowLeft size={17} />
                {roomId ? "Leave stream" : "End stream"}
              </button>
            </>
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
    </>
  );
}

export default function StreamApp() {
  const [room, setRoom] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const route = () => {
      const hash = window.location.hash.slice(1);
      setRoom(hash ? new URLSearchParams(hash).get("room") || "invalid" : null);
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Private Stream home">
          <span className="brand-icon">
            <MonitorPlay size={22} />
          </span>
          private<span>stream</span>
          <span className="beta-tag">P2P</span>
        </a>
        <span className="header-note">A little closer, wherever you are.</span>
      </header>
      <main>
        {room === undefined ? (
          <div className="loading" role="status">
            Getting ready…
          </div>
        ) : (
          <Session key={room ?? "host"} roomId={room} />
        )}
      </main>
      <footer>
        <span>Private Stream</span>
        <span>Your screens. Shared together.</span>
      </footer>
    </div>
  );
}
