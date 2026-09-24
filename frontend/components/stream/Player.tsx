import { useEffect, useRef, useState } from "react";
import { Headphones, MonitorPlay, Volume2 } from "lucide-react";
import type { StreamStats } from "@/lib/media";

export default function Player({
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

export function StreamStatsStrip({
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
