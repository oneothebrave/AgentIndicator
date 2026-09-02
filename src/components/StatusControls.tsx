import type { StreamConnectionState } from "../hooks/useStatusStream";

type StatusControlsProps = {
  streamUrl: string;
  connectionState: StreamConnectionState;
  lastError?: string;
  lastMessageAt?: number;
  onReset: () => void;
};

export function StatusControls({
  streamUrl,
  connectionState,
  lastError,
  lastMessageAt,
  onReset,
}: StatusControlsProps) {
  return (
    <aside className="panel" aria-label="Stream status">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Agent Indicator</p>
          <h1>Round Screen Simulator</h1>
        </div>
        <button className="ghostButton" type="button" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="controlGroup">
        <div className="groupLabel">Bridge</div>
        <div className="bridgeStatusRow">
          <span
            className={`connectionBadge connection-${connectionState}`}
            title={lastError}
          >
            {connectionState}
          </span>
          <span className="lastSeen">{formatLastSeen(lastMessageAt)}</span>
        </div>
        <div className="streamUrl" title={streamUrl}>
          {streamUrl}
        </div>
      </div>
    </aside>
  );
}

function formatLastSeen(value: number | undefined) {
  if (!value) {
    return "no messages";
  }

  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));

  if (seconds < 2) {
    return "just now";
  }

  return `${seconds}s ago`;
}
