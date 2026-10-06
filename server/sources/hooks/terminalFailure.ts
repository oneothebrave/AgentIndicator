import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

// CLI 0.153.4 compatibility adapter. Transcripts are not a stable API.
export function hasTerminalFailure(text: string, turnId: string): boolean {
  return text.split("\n").some((line) => {
    try {
      const record = JSON.parse(line);
      return (
        record.type === "event_msg" &&
        record.payload?.type === "task_complete" &&
        record.payload.turn_id === turnId &&
        typeof record.payload.error?.message === "string" &&
        record.payload.error.message.length > 0
      );
    } catch {
      return false;
    }
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
export function createTerminalFailureWatcher(
  root: string,
  getBinding: () => Binding,
  reportFailure: (session: string, turn: string) => unknown,
  options: { maxRecordBytes?: number; bytesPerPoll?: number } = {},
) {
  const maxRecordBytes = options.maxRecordBytes ?? 8 * 1024 * 1024;
  const bytesPerPoll = options.bytesPerPoll ?? 4 * 1024 * 1024;
  let stopped = false;
  let polling = false;
  let bindingKey = "";
  let transcriptPath: string | undefined;
  let offset = 0;
  let fileIdentityKey = "";
  let failureDelivered = false;
  let discardRecord = false;
  let recordBytes = 0;
  let recordParts: Buffer[] = [];
  const state: ObserverState = {
    phase: "unbound",
    lastReadAt: null,
    error: null,
    oversizedRecords: 0,
  };

  function resetReader() {
    offset = 0;
    fileIdentityKey = "";
    recordParts = [];
    recordBytes = 0;
    discardRecord = false;
    failureDelivered = false;
  }

  async function poll() {
    if (polling || stopped) {
      return;
    }
    const { sessionId, turnId } = getBinding();
    if (!sessionId || !turnId || !/^[a-zA-Z0-9-]+$/.test(sessionId)) {
      bindingKey = "";
      transcriptPath = undefined;
      resetReader();
      state.phase = "unbound";
      return;
    }
    polling = true;
    const isCurrentBinding = () =>
      !stopped && getBinding().sessionId === sessionId && getBinding().turnId === turnId;
    try {
      const nextBindingKey = `${sessionId}:${turnId}`;
      if (bindingKey !== nextBindingKey) {
        bindingKey = nextBindingKey;
        transcriptPath = undefined;
        resetReader();
        state.error = null;
      }
      if (!transcriptPath) {
        state.phase = "searching";
        const files = await readdir(root, { recursive: true });
        if (!isCurrentBinding()) {
          return;
        }
        const matches = files.filter((fileName) => fileName.endsWith(`-${sessionId}.jsonl`));
        if (matches.length !== 1) {
          state.phase = matches.length ? "ambiguous" : "missing";
          return;
        }
        transcriptPath = join(root, matches[0]);
      }
      const file = await open(transcriptPath, "r");
      try {
        const stat = await file.stat();
        const fileIdentity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        if (fileIdentityKey !== fileIdentity || stat.size < offset) {
          resetReader();
        }
        fileIdentityKey = fileIdentity;
        let bytesReadThisPoll = 0;
        while (offset < stat.size && bytesReadThisPoll < bytesPerPoll && isCurrentBinding()) {
          const buffer = Buffer.alloc(
            Math.min(65536, stat.size - offset, bytesPerPoll - bytesReadThisPoll),
          );
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          if (!bytesRead || !isCurrentBinding()) {
            break;
          }
          offset += bytesRead;
          bytesReadThisPoll += bytesRead;
          let pieceStart = 0;
          for (let byteIndex = 0; byteIndex <= bytesRead; byteIndex++) {
            if (byteIndex !== bytesRead && buffer[byteIndex] !== 10) {
              continue;
            }
            const piece = buffer.subarray(pieceStart, byteIndex);
            recordBytes += piece.length;
            if (!discardRecord && recordBytes > maxRecordBytes) {
              discardRecord = true;
              recordParts = [];
              state.oversizedRecords++;
              state.error = "record_too_large";
            }
            if (!discardRecord && piece.length) {
              recordParts.push(piece);
            }
            if (byteIndex < bytesRead) {
              if (
                !discardRecord &&
                !failureDelivered &&
                hasTerminalFailure(Buffer.concat(recordParts).toString("utf8"), turnId)
              ) {
                if (isCurrentBinding()) {
                  reportFailure(sessionId, turnId);
                  failureDelivered = true;
                }
              }
              recordParts = [];
              recordBytes = 0;
              discardRecord = false;
            }
            pieceStart = byteIndex + 1;
          }
        }
        if (isCurrentBinding()) {
          state.phase = "reading";
          state.lastReadAt = Date.now();
          if (state.error !== "record_too_large") {
            state.error = null;
          }
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isCurrentBinding()) {
        transcriptPath = undefined;
        resetReader();
        state.phase = "error";
        state.error = (error as NodeJS.ErrnoException).code ?? "read_failed";
      }
    } finally {
      polling = false;
    }
  }

  return {
    poll,
    status: () => ({ ...state }),
    stop() {
      stopped = true;
      state.phase = "stopped";
      recordParts = [];
    },
  };
}

export function watchTerminalFailures(
  root: string,
  getBinding: () => Binding,
  reportFailure: (session: string, turn: string) => unknown,
) {
  const observer = createTerminalFailureWatcher(root, getBinding, reportFailure);
  const timer = setInterval(() => void observer.poll(), 1000);
  timer.unref();
  return Object.assign(
    () => {
      clearInterval(timer);
      observer.stop();
    },
    { status: observer.status },
  );
}
