"""Bounded USB serial capture; requires pyserial. Does not assert reset lines."""

import argparse
import time
from pathlib import Path

import serial


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="COM3")
    parser.add_argument("--seconds", type=float, default=10)
    parser.add_argument("--expect")
    parser.add_argument("--send", default="")
    parser.add_argument("--output")
    args = parser.parse_args()

    if not 0 < args.seconds <= 60:
        parser.error("--seconds must be between 0 and 60")

    captured = []
    device = serial.Serial(port=None, baudrate=115200, timeout=0.2)
    device.dtr = False
    device.rts = False
    device.port = args.port
    device.open()

    with device:
        if args.send:
            device.write(args.send.encode("ascii"))

        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline:
            line = device.readline().decode("utf-8", errors="replace").rstrip()
            if line:
                captured.append(line)
                print(line, flush=True)

    text = "\n".join(captured) + "\n"
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")

    if args.expect and args.expect not in text:
        raise SystemExit("Expected serial marker was not observed: " + args.expect)


if __name__ == "__main__":
    main()
