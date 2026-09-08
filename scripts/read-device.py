"""Bounded USB serial capture; requires pyserial. Does not assert reset lines."""
import argparse
import time
from pathlib import Path
import serial

p = argparse.ArgumentParser()
p.add_argument('--port', default='COM3')
p.add_argument('--seconds', type=float, default=10)
p.add_argument('--expect')
p.add_argument('--send', default='')
p.add_argument('--output')
a = p.parse_args()
if not 0 < a.seconds <= 60:
    p.error('--seconds must be between 0 and 60')
captured = []
device = serial.Serial(port=None, baudrate=115200, timeout=.2)
device.dtr = False
device.rts = False
device.port = a.port
device.open()
with device:
    if a.send:
        device.write(a.send.encode('ascii'))
    end = time.monotonic() + a.seconds
    while time.monotonic() < end:
        line = device.readline().decode('utf-8', errors='replace').rstrip()
        if line:
            captured.append(line)
            print(line, flush=True)
text = '\n'.join(captured) + '\n'
if a.output:
    path = Path(a.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
if a.expect and a.expect not in text:
    raise SystemExit('Expected serial marker was not observed: ' + a.expect)
