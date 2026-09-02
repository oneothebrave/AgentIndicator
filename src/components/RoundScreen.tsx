import type { CSSProperties } from "react";
import type { AgentSnapshot } from "../domain/agentStatus";

type RoundScreenProps = {
  snapshot: AgentSnapshot;
  clock: Date;
};

const dimStates = new Set(["sleepy", "sleep"]);

export function RoundScreen({ snapshot, clock }: RoundScreenProps) {
  const time = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(clock);

  const date = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(clock);

  return (
    <section className="device" aria-label="Round screen simulator">
      <div className="deviceShell">
        <div
          className={`screen state-${snapshot.state}`}
          style={{ "--accent": snapshot.accent } as CSSProperties}
        >
          <div className="screenGlass" />
          <div className="screenGrid" />
          <div className="screenHud">
            <div>
              <div className="deviceTime">{time}</div>
              <div className="deviceDate">{date}</div>
            </div>
            <div className="statusPill">{snapshot.label}</div>
          </div>

          <div className="faceWrap">
            <div className="face">
              <div className="eyes">
                <span className="eye eyeLeft">
                  <span className="pupil" />
                </span>
                <span className="eye eyeRight">
                  <span className="pupil" />
                </span>
              </div>
              <span className="mouth" />
              {snapshot.state === "sleep" ? <span className="zzz">Zz</span> : null}
            </div>
          </div>

          <div className="screenFooter">
            <div className="shortState">{snapshot.lastEventType ?? "ready"}</div>
            <div className="detailText">{snapshot.detail}</div>
          </div>

          <div
            className="progressRing"
            aria-hidden="true"
            style={
              {
                "--progress": `${snapshot.progress}%`,
                opacity: dimStates.has(snapshot.state) ? 0.45 : 1,
              } as CSSProperties
            }
          />
        </div>
      </div>
    </section>
  );
}
