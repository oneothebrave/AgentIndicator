import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

// Compatibility adapter for CLI 0.153.4. Transcripts are not a stable API.
// Only explicit terminal errors for the bound turn are accepted; never infer
// failure from silence, retry warnings, assistant text, or another session.
export function hasTerminalFailure(text: string, turnId: string): boolean {
  return text.split("\n").some(line => {
    try {
      const r = JSON.parse(line);
      return r.type === "event_msg" && r.payload?.type === "task_complete"
        && r.payload.turn_id === turnId && typeof r.payload.error?.message === "string"
        && r.payload.error.message.length > 0;
    } catch { return false; }
  });
}

export function watchTerminalFailures(root: string, status: () => { sessionId: string | null; turnId: string | null }, fail: (session: string, turn: string) => unknown) {
  let stopped = false, busy = false, cachedSession = "", path: string | undefined;
  let searchedAt = 0;
  async function poll() {
    if (busy || stopped) return;
    const { sessionId, turnId } = status();
    if (!sessionId || !turnId || !/^[a-zA-Z0-9-]+$/.test(sessionId)) return;
    busy = true;
    try {
      if (cachedSession !== sessionId) { cachedSession = sessionId; path = undefined; searchedAt = 0; }
      if (!path && Date.now() - searchedAt > 10000) {
        searchedAt = Date.now();
        const files = await readdir(root, { recursive: true });
        const matches = files.filter(f => f.endsWith(`-${sessionId}.jsonl`));
        if (matches.length === 1) path = join(root, matches[0]);
      }
      if (!path) return;
      const file = await open(path, "r");
      try {
        const size = (await file.stat()).size, start = Math.max(0, size - 65536);
        const buffer = Buffer.alloc(Math.min(size, 65536));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
        let text = buffer.subarray(0, bytesRead).toString("utf8");
        if (start) text = text.slice(text.indexOf("\n") + 1);
        text = text.slice(0, text.lastIndexOf("\n") + 1);
        if (!stopped && hasTerminalFailure(text, turnId)) fail(sessionId, turnId);
      } finally { await file.close(); }
    } catch { /* Missing/incomplete transcript does not imply an agent error. */ }
    finally { busy = false; }
  }
  const timer = setInterval(() => void poll(), 1000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
