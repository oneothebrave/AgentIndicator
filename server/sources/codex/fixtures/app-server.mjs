// Local protocol fixture: never starts Codex or calls a model.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const [mode, trace] = process.argv.slice(2);
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (trace) {
    appendFileSync(trace, request.method + "\n");
  }
  if (mode === "hang") {
    return;
  }
  if (request.method === "initialize") {
    emit({ id: request.id, result: {} });
  }
  if (request.method === "thread/start") {
    emit({ id: request.id, result: { thread: { id: "thread" } } });
  }
  if (request.method === "turn/start") {
    emit({
      method: "turn/started",
      params: { threadId: "thread", turn: { id: "turn", status: "inProgress" } },
    });
    if (mode !== "timeout") {
      emit({ id: request.id, result: {} });
    }
    const lag = mode === "timeout" ? 1000 : 0;
    setTimeout(
      () =>
        emit({
          method: "item/reasoning/textDelta",
          params: { threadId: "thread", turnId: "turn" },
        }),
      lag + 350,
    );
    setTimeout(
      () =>
        emit({
          method: "turn/completed",
          params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
        }),
      lag + 600,
    );
  }
});
