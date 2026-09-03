import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { CodexAppServerLaunchConfig } from "./types";

type CodexAppServerProcessHandlers = {
  onLine: (line: string) => void;
  onStderrLine: (line: string) => void;
  onExit: (error: Error, description: string) => void;
};

export class CodexAppServerProcess {
  private child?: ChildProcessWithoutNullStreams;
  private stdoutReader?: Interface;

  constructor(
    private readonly launchConfig: CodexAppServerLaunchConfig,
    private readonly handlers: CodexAppServerProcessHandlers,
  ) {}

  start() {
    if (this.child) {
      return;
    }

    const child = spawn(this.launchConfig.command, this.launchConfig.args, {
      cwd: this.launchConfig.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout.setEncoding("utf8");
    this.stdoutReader = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    this.stdoutReader.on("line", this.handlers.onLine);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.handleStderr(chunk);
    });

    let exitReported = false;
    const reportExit = (error: Error, description: string) => {
      if (exitReported) {
        return;
      }

      exitReported = true;

      if (this.child !== child) {
        return;
      }

      this.clearChild();
      this.handlers.onExit(error, description);
    };

    child.on("error", (error) => {
      reportExit(error, error.message);
    });

    child.on("exit", (code, signal) => {
      const description = `code ${code ?? "unknown"}, signal ${
        signal ?? "none"
      }`;
      reportExit(
        new Error(`codex app-server exited with ${description}`),
        description,
      );
    });
  }

  writeLine(line: string) {
    if (!this.child?.stdin.writable) {
      throw new Error("codex app-server stdin is not writable");
    }

    this.child.stdin.write(`${line}\n`);
  }

  stop() {
    const child = this.child;
    this.clearChild();

    if (child && !child.killed) {
      child.kill();
    }
  }

  private handleStderr(chunk: string) {
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (trimmed) {
        this.handlers.onStderrLine(trimmed);
      }
    }
  }

  private clearChild() {
    this.stdoutReader?.close();
    this.stdoutReader = undefined;
    this.child = undefined;
  }
}
