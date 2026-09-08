import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

// CLI 0.153.4 compatibility adapter. Transcripts are not a stable API.
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

type Binding = { sessionId: string | null; turnId: string | null };
type ObserverState = {
  phase: "unbound" | "searching" | "reading" | "missing" | "ambiguous" | "error" | "stopped";
  lastReadAt: number | null;
  error: string | null;
  oversizedRecords: number;
};

/** Incremental byte framing: UTF-8 and JSON records may cross any read boundary. */
export function createTerminalFailureWatcher(root: string, status: () => Binding,
  fail: (session: string, turn: string) => unknown,
  options: { maxRecordBytes?: number; bytesPerPoll?: number } = {}) {
  const maxRecord = options.maxRecordBytes ?? 8 * 1024 * 1024;
  const budget = options.bytesPerPoll ?? 4 * 1024 * 1024;
  let stopped = false, busy = false, binding = "", path: string | undefined;
  let offset = 0, identity = "", delivered = false, discard = false, recordBytes = 0;
  let parts: Buffer[] = [];
  const state: ObserverState = { phase: "unbound", lastReadAt: null, error: null, oversizedRecords: 0 };
  function resetReader() { offset = 0; identity = ""; parts = []; recordBytes = 0; discard = false; delivered = false; }

  async function poll() {
    if (busy || stopped) return;
    const { sessionId, turnId } = status();
    if (!sessionId || !turnId || !/^[a-zA-Z0-9-]+$/.test(sessionId)) {
      binding = ""; path = undefined; resetReader(); state.phase = "unbound"; return;
    }
    busy = true;
    const sameBinding = () => !stopped && status().sessionId === sessionId && status().turnId === turnId;
    try {
      const next = `${sessionId}:${turnId}`;
      if (binding !== next) { binding = next; path = undefined; resetReader(); state.error = null; }
      if (!path) {
        state.phase = "searching";
        const files = await readdir(root, { recursive: true });
        if (!sameBinding()) return;
        const matches = files.filter(f => f.endsWith(`-${sessionId}.jsonl`));
        if (matches.length !== 1) { state.phase = matches.length ? "ambiguous" : "missing"; return; }
        path = join(root, matches[0]);
      }
      const file = await open(path, "r");
      try {
        const stat = await file.stat();
        const fileIdentity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        if (identity !== fileIdentity || stat.size < offset) resetReader();
        identity = fileIdentity;
        let read = 0;
        while (offset < stat.size && read < budget && sameBinding()) {
          const buffer = Buffer.alloc(Math.min(65536, stat.size - offset, budget - read));
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          if (!bytesRead || !sameBinding()) break;
          offset += bytesRead; read += bytesRead;
          let start = 0;
          for (let i = 0; i <= bytesRead; i++) {
            if (i !== bytesRead && buffer[i] !== 10) continue;
            const piece = buffer.subarray(start, i);
            recordBytes += piece.length;
            if (!discard && recordBytes > maxRecord) {
              discard = true; parts = []; state.oversizedRecords++; state.error = "record_too_large";
            }
            if (!discard && piece.length) parts.push(piece);
            if (i < bytesRead) {
              if (!discard && !delivered && hasTerminalFailure(Buffer.concat(parts).toString("utf8"), turnId)) {
                if (sameBinding()) { fail(sessionId, turnId); delivered = true; }
              }
              parts = []; recordBytes = 0; discard = false;
            }
            start = i + 1;
          }
        }
        if (sameBinding()) { state.phase = "reading"; state.lastReadAt = Date.now(); if (state.error !== "record_too_large") state.error = null; }
      } finally { await file.close(); }
    } catch (error) {
      if (sameBinding()) {
        path = undefined; resetReader(); state.phase = "error";
        state.error = (error as NodeJS.ErrnoException).code ?? "read_failed";
      }
    } finally { busy = false; }
  }
  return { poll, status: () => ({ ...state }), stop() { stopped = true; state.phase = "stopped"; parts = []; } };
}

export function watchTerminalFailures(root: string, status: () => Binding, fail: (session: string, turn: string) => unknown) {
  const observer = createTerminalFailureWatcher(root, status, fail);
  const timer = setInterval(() => void observer.poll(), 1000);
  timer.unref();
  return Object.assign(() => { clearInterval(timer); observer.stop(); }, { status: observer.status });
}
