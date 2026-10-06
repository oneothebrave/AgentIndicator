// Read-only Windows process adapter. Handles retain the original process even
// when Windows later reuses its PID. No command line leaves this module.
import { createRequire } from "node:module";
import { win32 } from "node:path";

const require = createRequire(import.meta.url);
const QUERY_LIMITED_INFORMATION = 0x1000;
const SYNCHRONIZE = 0x100000;
const WAIT_TIMEOUT = 0x102;
const MAX_COMMAND_BYTES = 128 * 1024;
let native;

function windowsApi() {
  if (process.platform !== "win32") {
    throw new Error("unsupported-platform");
  }
  if (native) {
    return native;
  }

  const koffi = require("koffi");
  const kernel = koffi.load("kernel32.dll");
  const nt = koffi.load("ntdll.dll");
  const shell = koffi.load("shell32.dll");
  const fileTime = koffi.struct({ low: "uint32", high: "uint32" });
  const entry = koffi.struct({
    size: "uint32",
    usage: "uint32",
    pid: "uint32",
    heap: "uintptr_t",
    module: "uint32",
    threads: "uint32",
    parent: "uint32",
    priority: "int32",
    flags: "uint32",
    name: koffi.array("uint16", 260),
  });
  const unicode = koffi.struct({ length: "uint16", maximum: "uint16", buffer: "void *" });
  native = {
    koffi,
    entry,
    fileTime,
    unicode,
    snapshot: kernel.func("void * __stdcall CreateToolhelp32Snapshot(uint32, uint32)"),
    first: kernel.func("__stdcall", "Process32FirstW", "int", [
      "void *",
      koffi.inout(koffi.pointer(entry)),
    ]),
    next: kernel.func("__stdcall", "Process32NextW", "int", [
      "void *",
      koffi.inout(koffi.pointer(entry)),
    ]),
    open: kernel.func("void * __stdcall OpenProcess(uint32, int, uint32)"),
    close: kernel.func("int __stdcall CloseHandle(void *)"),
    wait: kernel.func("uint32 __stdcall WaitForSingleObject(void *, uint32)"),
    times: kernel.func("__stdcall", "GetProcessTimes", "int", [
      "void *",
      ...Array.from({ length: 4 }, () => koffi.out(koffi.pointer(fileTime))),
    ]),
    image: kernel.func(
      "int __stdcall QueryFullProcessImageNameW(void *, uint32, void *, _Inout_ uint32 *)",
    ),
    query: nt.func(
      "int32 __stdcall NtQueryInformationProcess(void *, uint32, void *, uint32, _Out_ uint32 *)",
    ),
    argv: shell.func("void * __stdcall CommandLineToArgvW(str16, _Out_ int *)"),
    free: kernel.func("void * __stdcall LocalFree(void *)"),
  };
  return native;
}

export function isProcessIdentity(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    value.pid <= 0xffffffff &&
    typeof value.started_at === "string" &&
    /^[1-9][0-9]{0,19}$/.test(value.started_at),
  );
}

function processBirth(api, handle) {
  const created = {};
  if (!api.times(handle, created, {}, {}, {})) {
    throw new Error("process-time-unavailable");
  }
  return ((BigInt(created.high) << 32n) | BigInt(created.low)).toString();
}

function commandArgs(api, handle) {
  // Class 60 is a version-dependent Windows adapter. Unsupported or denied
  // queries disable automatic recovery; they never imply that a CLI exited.
  const bytes = [0];
  api.query(handle, 60, null, 0, bytes);
  if (bytes[0] < api.koffi.sizeof(api.unicode) || bytes[0] > MAX_COMMAND_BYTES) {
    throw new Error("process-command-unavailable");
  }
  const buffer = Buffer.alloc(bytes[0]);
  if (api.query(handle, 60, buffer, buffer.length, bytes) < 0) {
    throw new Error("process-command-unavailable");
  }
  const text = api.koffi.decode(buffer, api.unicode);
  const start = api.koffi.address(buffer);
  const pointer = text.buffer ? api.koffi.address(text.buffer) : 0n;
  const offset = Number(pointer - start);
  if (text.length % 2 || offset < 0 || offset + text.length > buffer.length) {
    throw new Error("process-command-unavailable");
  }
  const command = buffer.subarray(offset, offset + text.length).toString("utf16le");
  const count = [0];
  const argv = api.argv(command, count);
  if (!argv) {
    throw new Error("process-command-unavailable");
  }
  try {
    if (count[0] < 1 || count[0] > 32768) {
      throw new Error("process-command-unavailable");
    }
    return api.koffi.decode(argv, api.koffi.array("str16", count[0]));
  } finally {
    api.free(argv);
  }
}

// The exact native executable and parsed subcommand are checked, rather than
// treating every Codex desktop/app-server process as an interactive terminal.
export function isInteractiveCodex(image, args) {
  if (
    win32.basename(image).toLowerCase() !== "codex.exe" ||
    !Array.isArray(args) ||
    args.length === 0 ||
    !args.every((arg) => typeof arg === "string")
  ) {
    return false;
  }
  const nonInteractive = new Set([
    "app-server",
    "exec-server",
    "mcp-server",
    "exec",
    "e",
    "review",
    "login",
    "logout",
    "mcp",
    "completion",
    "debug",
    "sandbox",
    "apply",
    "a",
    "features",
    "help",
  ]);
  // Conservative exclusion is safe even if a positional prompt has one of
  // these names: it leaves manual recovery available instead of monitoring it.
  return !args
    .slice(1)
    .some((arg) => nonInteractive.has(arg) || ["--help", "-h", "--version", "-V"].includes(arg));
}

export function observeWindowsProcess(identity, requireCli = false) {
  if (!isProcessIdentity(identity)) {
    throw new Error("invalid-process-identity");
  }
  const api = windowsApi();
  const handle = api.open(QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, identity.pid);
  if (!handle) {
    throw new Error("process-open-unavailable");
  }
  try {
    if (processBirth(api, handle) !== identity.started_at) {
      throw new Error("process-identity-changed");
    }
    if (requireCli) {
      const image = Buffer.alloc(32768 * 2);
      const length = [32768];
      if (
        !api.image(handle, 0, image, length) ||
        !isInteractiveCodex(
          image.subarray(0, length[0] * 2).toString("utf16le"),
          commandArgs(api, handle),
        )
      ) {
        throw new Error("not-interactive-cli");
      }
    }
  } catch (error) {
    api.close(handle);
    throw error;
  }
  let closed = false;
  return {
    poll() {
      if (closed) {
        return "unknown";
      }
      const result = api.wait(handle, 0);
      if (result === 0) {
        return "exited";
      }
      if (result === WAIT_TIMEOUT) {
        return "alive";
      }
      return "unknown";
    },
    close() {
      if (!closed) {
        closed = true;
        api.close(handle);
      }
    },
  };
}

export function identifyHookProcess(parentPid = process.ppid) {
  try {
    const api = windowsApi();
    const snapshot = api.snapshot(2, 0);
    if (!snapshot || BigInt.asIntN(64, api.koffi.address(snapshot)) === -1n) {
      return { kind: "unknown" };
    }
    const parents = new Map();
    try {
      const row = { size: api.koffi.sizeof(api.entry) };
      if (api.first(snapshot, row)) {
        do {
          const bytes = Buffer.from(new Uint16Array(row.name).buffer);
          parents.set(row.pid, {
            parent: row.parent,
            name: bytes.toString("utf16le").split("\0")[0],
          });
        } while (api.next(snapshot, row));
      }
    } finally {
      api.close(snapshot);
    }
    let pid = parentPid;
    const visited = new Set();
    for (let depth = 0; depth < 16 && pid && !visited.has(pid); depth++) {
      visited.add(pid);
      const row = parents.get(pid);
      if (!row) {
        return { kind: "unknown" };
      }
      if (row.name.toLowerCase() === "codex.exe") {
        const handle = api.open(QUERY_LIMITED_INFORMATION, 0, pid);
        if (!handle) {
          return { kind: "unknown" };
        }
        try {
          if (!isInteractiveCodex(row.name, commandArgs(api, handle))) {
            return { kind: "other" };
          }
          return { kind: "cli", identity: { pid, started_at: processBirth(api, handle) } };
        } finally {
          api.close(handle);
        }
      }
      pid = row.parent;
    }
  } catch {
    // Missing native runtime, permissions, unsupported OS: hook stays benign.
  }
  return { kind: "unknown" };
}

export function findCliProcess(parentPid = process.ppid) {
  const result = identifyHookProcess(parentPid);
  return result.kind === "cli" ? result.identity : undefined;
}

export function windowsProcessIdentity(pid) {
  const api = windowsApi();
  const handle = api.open(QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) {
    throw new Error("process-open-unavailable");
  }
  try {
    return { pid, started_at: processBirth(api, handle) };
  } finally {
    api.close(handle);
  }
}
