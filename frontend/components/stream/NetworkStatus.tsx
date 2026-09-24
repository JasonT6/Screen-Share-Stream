import { Activity, Wifi, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "@/lib/connection-quality";

export default function NetworkStatus({
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
