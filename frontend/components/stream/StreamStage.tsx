import { Headphones, MonitorPlay } from "lucide-react";
import { uploadStatus, unknownStatus } from "@/lib/connection-quality";
import Player, { StreamStatsStrip } from "./Player";
import QualitySelector from "./QualitySelector";
import NetworkStatus from "./NetworkStatus";
import type { StreamSessionState } from "./useStreamSession";

type StreamStageProps = Pick<
  StreamSessionState,
  | "selectedParticipant"
  | "stream"
  | "selectedId"
  | "ownId"
  | "ready"
  | "stats"
  | "playbackQuality"
  | "changePlaybackQuality"
  | "playbackPreferences"
  | "receiveHealth"
  | "remoteHealth"
> & { roomId: string | null };

export default function StreamStage({
  roomId,
  selectedParticipant,
  stream,
  selectedId,
  ownId,
  ready,
  stats,
  playbackQuality,
  changePlaybackQuality,
  playbackPreferences,
  receiveHealth,
  remoteHealth
}: StreamStageProps) {
  return (
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
      <StreamStatsStrip
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
            Connection estimates from live streams. Click an icon for details.
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
  );
}
