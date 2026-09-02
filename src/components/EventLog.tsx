import type { AgentEvent } from "../domain/agentStatus";

type EventLogProps = {
  events: AgentEvent[];
};

export function EventLog({ events }: EventLogProps) {
  return (
    <section className="eventPanel" aria-label="Event stream">
      <div className="eventPanelHeader">
        <span>Event Stream</span>
        <span>{events.length}</span>
      </div>
      <div className="eventList">
        {events.length === 0 ? (
          <div className="emptyLog">No events yet</div>
        ) : (
          events.map((event) => (
            <article className="eventItem" key={event.id}>
              <time>{formatTime(event.at)}</time>
              <div>
                <div className="eventMeta">
                  <strong>{event.type}</strong>
                  <span>{event.source}</span>
                </div>
                <span className="eventDetail">
                  {event.detail ?? event.label ?? "status update"}
                </span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}
