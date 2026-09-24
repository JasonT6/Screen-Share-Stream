import type { ReactNode } from "react";
import {
  QUALITY_PRESETS,
  VIDEO_PRIORITIES,
  AUDIO_QUALITIES,
  type StreamPreferences,
  type StreamQuality
} from "@/lib/media";

export default function QualitySelector({
  id,
  label,
  value,
  onChange,
  disabled,
  preferences,
  onPreferences,
  children
}: {
  children?: ReactNode;
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
        {children ? (
          <>
            <span>{label}</span>
            <label htmlFor={id}>Resolution</label>
          </>
        ) : (
          <label htmlFor={id}>{label}</label>
        )}
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
      {children}
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
