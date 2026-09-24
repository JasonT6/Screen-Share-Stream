import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  browserError,
  captureDisplay,
  PUBLISH_PREFERENCES,
  PLAYBACK_PREFERENCES,
  type StreamQuality,
  type FrameRate
} from "@/lib/media";
import { passwordError, usernameError, type Participant } from "@/lib/protocol";
import { HostSession } from "@/lib/session/host-session";
import { ViewerSession } from "@/lib/session/viewer-session";
import type { RoomSession, SessionEvents } from "@/lib/session/room-session";
import {
  emptyMeasurements,
  summarizeUpload,
  uploadStatus,
  playbackStatus
} from "@/lib/connection-quality";
import { emptyDiagnostics } from "@/lib/diagnostics";

export function useStreamSession(roomId: string | null) {
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
  const [diagnostics, setDiagnostics] = useState(emptyDiagnostics);
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
    const current = session.current;
    current?.close();
    if (current) {
      const snapshot = current.diagnostics();
      setDiagnostics({
        ...snapshot,
        websocket: snapshot.websocket === "error" ? "error" : "closed"
      });
    }
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
      diagnostics: (value) => {
        if (current()) setDiagnostics(value);
      },
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
    setDiagnostics(emptyDiagnostics());
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

  function stopSharing() {
    void session.current
      ?.stopSharing()
      .catch((failure) => setNotice(failure.message));
  }

  function cancelSharing() {
    shareAttempt.current++;
    setSharingBusy(false);
  }

  return {
    username,
    setUsername,
    password,
    setPassword,
    publishQuality,
    publishPreferences,
    changePublishQuality,
    playbackQuality,
    playbackPreferences,
    changePlaybackQuality,
    frameRate,
    setFrameRate,
    busy,
    sharingBusy,
    ready,
    ended,
    link,
    copied,
    copy,
    participants,
    selectedId,
    setSelected,
    selectedParticipant,
    ownId,
    ownStream,
    stream,
    stats,
    ownHealth,
    remoteHealth,
    receiveHealth,
    diagnostics,
    error,
    notice,
    enter,
    leave,
    share,
    stopSharing,
    cancelSharing
  };
}

export type StreamSessionState = ReturnType<typeof useStreamSession>;
