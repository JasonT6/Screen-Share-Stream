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
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Headphones,
  Link as LinkIcon,
  LockKeyhole,
  MonitorPlay,
  Radio,
  ScreenShare,
  ShieldCheck,
  Square,
  Users,
  Volume2
} from "lucide-react";
import {
  browserError,
  captureDisplay,
  type FrameRate,
  type StreamStats
} from "@/lib/media";
import { passwordError, randomHex, ROOM_PATTERN } from "@/lib/protocol";
import {
  HostSession,
  ViewerSession,
  type ViewerInfo
} from "@/lib/stream-session";

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
            create
              ? "Choose a phrase, at least 12 characters"
              : "Enter the password from your host"
          }
          required
          minLength={create ? 12 : 1}
          maxLength={256}
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
              : "Enter the stream password to start watching."}
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

function useSessionStats(
  session: React.MutableRefObject<HostSession | ViewerSession | null>
) {
  const [stats, setStats] = useState<StreamStats | null>(null);
  useEffect(() => {
    let disposed = false;
    const timer = setInterval(() => {
      const current = session.current;
      if (!current) {
        setStats(null);
        return;
      }
      void current
        .stats()
        .then((value) => {
          if (!disposed && session.current === current) setStats(value);
        })
        .catch(() => {});
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [session]);
  return stats;
}

function Host() {
  const session = useRef<HostSession | null>(null);
  const capture = useRef<MediaStream | null>(null);
  const attempt = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [password, setPassword] = useState("");
  const [frameRate, setFrameRate] = useState<FrameRate>(60);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const stats = useSessionStats(session);

  const stop = useCallback((message = "") => {
    attempt.current++;
    capture.current?.getTracks().forEach((track) => track.stop());
    capture.current = null;
    const current = session.current;
    session.current = null;
    if (current) void current.end();
    setStream(null);
    setLink("");
    setViewers([]);
    setBusy(false);
    setNotice("");
    setError(message);
  }, []);

  useEffect(() => {
    const lifecycle = attempt;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (capture.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const pageHide = () => stop();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    return () => {
      lifecycle.current++;
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
      capture.current?.getTracks().forEach((track) => track.stop());
      void session.current?.end();
    };
  }, [stop]);

  async function start(event: FormEvent) {
    event.preventDefault();
    const issue = browserError(true) || passwordError(password);
    if (issue) {
      setError(issue);
      return;
    }
    const currentAttempt = ++attempt.current;
    setError("");
    setNotice("");
    setBusy(true);
    let source: MediaStream | undefined;
    try {
      // Keep capture immediately inside the click gesture, before crypto/network awaits.
      source = await captureDisplay(frameRate);
      if (currentAttempt !== attempt.current) {
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      capture.current = source;
      setStream(source);
      source.getVideoTracks()[0].addEventListener(
        "ended",
        () => {
          if (attempt.current === currentAttempt)
            stop(
              "Screen sharing stopped. Start a new stream when you’re ready."
            );
        },
        { once: true }
      );
      source.getAudioTracks()[0].addEventListener(
        "ended",
        () => {
          if (attempt.current === currentAttempt)
            stop(
              "Shared audio stopped, so the stream ended. Share again with audio enabled."
            );
        },
        { once: true }
      );
      const host = await HostSession.start(password, source, {
        viewers: (value) => {
          if (attempt.current === currentAttempt) setViewers(value);
        },
        notice: (value) => {
          if (attempt.current === currentAttempt) setNotice(value);
        }
      });
      if (currentAttempt !== attempt.current) {
        void host.end();
        return;
      }
      session.current = host;
      const invitation = new URL(window.location.href);
      invitation.search = "";
      invitation.hash = `room=${host.roomId}`;
      setLink(invitation.href);
    } catch (failure) {
      source?.getTracks().forEach((track) => track.stop());
      if (currentAttempt !== attempt.current) return;
      capture.current = null;
      setStream(null);
      setError(
        failure instanceof DOMException && failure.name === "NotAllowedError"
          ? "Screen sharing was canceled or blocked. Try again when ready. If macOS asks to bypass the private screen picker, cancel that request."
          : failure instanceof Error
            ? failure.message
            : "The stream could not start. Please try again."
      );
    } finally {
      if (currentAttempt === attempt.current) setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Copy the invitation from the link field below.");
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR OWN PRIVATE SCREENING</p>
          <h1>Good things are better shared.</h1>
          <p>Full-resolution video. Original audio. Just your people.</p>
        </div>
        <span className={`status-pill ${link ? "live" : ""}`}>
          <span className="dot" />
          {link
            ? "You’re live"
            : busy
              ? "Starting stream"
              : "Ready when you are"}
        </span>
      </div>
      <div className="workspace">
        <section className="stage">
          <div className="stage-heading">
            <span>
              <MonitorPlay size={18} /> Your stream
            </span>
            <span className="small-label">DIRECT · PRIVATE</span>
          </div>
          <Player stream={stream} preview />
          <Quality source={stream} stats={stats} />
          <div className="stage-note">
            <ShieldCheck size={17} />
            <span>
              Video and audio go directly from your browser to each viewer.
            </span>
          </div>
        </section>
        <aside className="side-panel">
          {!link ? (
            <form onSubmit={start}>
              <div className="panel-icon">
                <ScreenShare size={22} />
              </div>
              <h2>Start a stream</h2>
              <p className="muted">
                Choose what to share in your browser’s screen picker. Invite
                people with a link and a password.
              </p>
              <PasswordField
                value={password}
                onChange={setPassword}
                create
                disabled={busy}
              />
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
                <p className="field-help">
                  No resolution cap. Actual quality depends on the source,
                  browser, and connection.
                </p>
              </div>
              <div className="audio-tip">
                <Headphones size={19} />
                <p>
                  <strong>Remember to share audio.</strong> In desktop Chrome or
                  Edge, share a browser tab and turn on “Share tab audio”.
                </p>
              </div>
              <Problem>{error}</Problem>
              <button type="submit" className="button full" disabled={busy}>
                <ScreenShare size={18} />
                {busy ? "Starting…" : "Share screen & audio"}
                {!busy && <ArrowUpRight size={17} />}
              </button>
              {busy && (
                <button
                  type="button"
                  className="text-button full"
                  onClick={() => stop()}
                >
                  Cancel
                </button>
              )}
              <p className="footnote">Keep this tab open while you stream.</p>
            </form>
          ) : (
            <>
              <div className="panel-icon">
                <LinkIcon size={22} />
              </div>
              <h2>Invite your people</h2>
              <p className="muted">
                Send this link and the password. They’ll connect as soon as they
                enter it.
              </p>
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
              </div>
              <PasswordField value={password} onChange={setPassword} disabled />
              <p className="field-help">
                The password is not included in the link. Share it separately.
              </p>
              <div className="viewers-heading">
                <span>
                  <Users size={17} /> Viewers
                </span>
                <span>{viewers.length}</span>
              </div>
              {viewers.length ? (
                <ul className="viewer-list">
                  {viewers.map((viewer) => (
                    <li key={viewer.id}>
                      <span className="avatar">
                        <Eye size={16} />
                      </span>
                      <span>{viewer.label}</span>
                      <small>{viewer.status}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-viewers">
                  Your stream is ready for company.
                </p>
              )}
              <Problem>{notice}</Problem>
              <button
                type="button"
                className="button full danger"
                onClick={() => stop()}
              >
                <Square size={15} fill="currentColor" />
                End stream
              </button>
            </>
          )}
        </aside>
      </div>
      <div className="bottom-notes">
        <span>
          <LockKeyhole size={15} /> Password protected
        </span>
        <span>
          <Radio size={15} /> Peer-to-peer streaming
        </span>
        <span>
          <Headphones size={15} /> Shared audio included
        </span>
      </div>
    </>
  );
}

function Watch({ roomId }: { roomId: string }) {
  const session = useRef<ViewerSession | null>(null);
  const attempt = useRef(0);
  const [password, setPassword] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const [ended, setEnded] = useState(false);
  const stats = useSessionStats(session);
  useEffect(() => {
    const lifecycle = attempt;
    const pageHide = () => {
      lifecycle.current++;
      session.current?.close();
      session.current = null;
      setStream(null);
      setActive(false);
      setStatus("");
    };
    window.addEventListener("pagehide", pageHide);
    return () => {
      lifecycle.current++;
      session.current?.close();
      window.removeEventListener("pagehide", pageHide);
    };
  }, []);

  function leave() {
    attempt.current++;
    session.current?.close();
    session.current = null;
    setStream(null);
    setActive(false);
    setStatus("");
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    const issue = browserError(false);
    if (issue) {
      setError(issue);
      return;
    }
    session.current?.close();
    const currentAttempt = ++attempt.current;
    const current = () => attempt.current === currentAttempt;
    setError("");
    setEnded(false);
    setActive(true);
    setStatus("Finding the host");
    try {
      const viewer = await ViewerSession.join(roomId, password, {
        status: (value) => {
          if (current()) setStatus(value);
        },
        stream: (value) => {
          if (current()) setStream(value);
        },
        error: (value) => {
          if (current()) {
            setError(value);
            setActive(false);
            setStatus("");
          }
        },
        ended: () => {
          if (current()) {
            setEnded(true);
            setActive(false);
            setStatus("");
          }
        }
      });
      if (!current()) {
        viewer.close();
        return;
      }
      session.current = viewer;
    } catch (failure) {
      if (current()) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not connect to the stream."
        );
        setActive(false);
        setStatus("");
      }
    }
  }

  if (!ROOM_PATTERN.test(roomId))
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
          <p className="eyebrow">YOU’RE INVITED</p>
          <h1>
            {ended
              ? "That’s a wrap."
              : stream
                ? "Sit back. You’re connected."
                : "Something good is on."}
          </h1>
          <p>
            {ended
              ? "The host has ended this stream."
              : "A private stream, shared directly with you."}
          </p>
        </div>
        <span className={`status-pill ${stream ? "live" : ""}`}>
          <span className="dot" />
          {status || (ended ? "Stream ended" : "Private invitation")}
        </span>
      </div>
      <div className="workspace">
        <section className="stage">
          <div className="stage-heading">
            <span>
              <MonitorPlay size={18} /> Live stream
            </span>
            <span className="small-label">WATCH & LISTEN</span>
          </div>
          <Player stream={stream} />
          <Quality stats={stats} />
          <div className="stage-note">
            <Headphones size={17} />
            <span>Use the player controls for volume and fullscreen.</span>
          </div>
        </section>
        <aside className="side-panel">
          <div className="panel-icon">
            {ended ? <Check size={22} /> : <LockKeyhole size={22} />}
          </div>
          <h2>
            {ended
              ? "Thanks for watching"
              : active
                ? "Your connection"
                : "Join the stream"}
          </h2>
          <p className="muted">
            {ended
              ? "Ask your host for a new invitation when they start again."
              : active
                ? "The host’s screen and audio are delivered straight to your browser."
                : "Enter the password your host shared with you. You’ll join automatically."}
          </p>
          {!active && !ended && (
            <form onSubmit={join}>
              <PasswordField value={password} onChange={setPassword} />
              <Problem>{error}</Problem>
              <button type="submit" className="button full">
                <MonitorPlay size={18} />
                {error ? "Try again" : "Connect to stream"}
                <ArrowUpRight size={17} />
              </button>
            </form>
          )}
          {active && (
            <>
              <div className="connection-detail">
                <span className="dot" />
                <span>{status}</span>
              </div>
              <button className="button secondary full" onClick={leave}>
                <ArrowLeft size={17} />
                {stream ? "Leave stream" : "Cancel connection"}
              </button>
            </>
          )}
          {ended && (
            <a className="button secondary full" href="/">
              Back to Private Stream
            </a>
          )}
          <div className="viewer-privacy">
            <ShieldCheck size={19} />
            <p>
              You only watch and listen. No microphone or camera access is
              requested.
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
        ) : room === null ? (
          <Host />
        ) : (
          <Watch key={room} roomId={room} />
        )}
      </main>
      <footer>
        <span>Private Stream</span>
        <span>One screen. Shared together.</span>
      </footer>
    </div>
  );
}
