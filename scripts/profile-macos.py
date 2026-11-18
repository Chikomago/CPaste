"""Read-only macOS process profiling. Does not inspect clipboard contents."""
import argparse
import ctypes
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone

FIELDS = ['user_ns', 'system_ns', 'idle_wakeups', 'interrupt_wakeups', 'pageins',
          'wired_bytes', 'resident_bytes', 'footprint_bytes', 'start', 'exit',
          'child_user', 'child_system', 'child_idle', 'child_interrupt',
          'child_pageins', 'child_elapsed', 'disk_read_bytes', 'disk_written_bytes']

class Usage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(key, ctypes.c_uint64) for key in FIELDS]


def percentile(values, fraction):
    values = sorted(values)
    position = (len(values) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--seconds', type=int, default=30)
    parser.add_argument('--label', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.seconds < 1:
        parser.error('--seconds must be positive')
    if sys.platform != 'darwin':
        parser.error('macOS only')
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    responsible = lib.responsibility_get_pid_responsible_for_pid
    responsible.argtypes = [ctypes.c_int]
    responsible.restype = ctypes.c_int

    def members():
        rows = subprocess.check_output(['ps', '-ax', '-o', 'pid=,ppid=,comm='], text=True)
        result = {}
        for line in rows.splitlines():
            pid, parent, name = line.strip().split(None, 2)
            pid = int(pid)
            if pid == args.pid or ('WebKit' in name and responsible(pid) == args.pid):
                result[pid] = Path(name).name
        return result

    samples = []
    previous = {}
    previous_time = time.monotonic()
    for index in range(args.seconds + 1):
        start = time.monotonic()
        processes = []
        for pid, name in members().items():
            usage = Usage()
            if lib.proc_pid_rusage(pid, 2, ctypes.byref(usage)) != 0:
                continue
            row = {key: getattr(usage, key) for key in FIELDS}
            row.update(pid=pid, name=name)
            old = previous.get(pid)
            elapsed = max(start - previous_time, 0.0001)
            for metric, fields, scale in [
                ('cpu_percent', ['user_ns', 'system_ns'], 100 / 1e9),
                ('idle_wakeups_per_second', ['idle_wakeups'], 1),
                ('disk_read_bytes_per_second', ['disk_read_bytes'], 1),
                ('disk_written_bytes_per_second', ['disk_written_bytes'], 1),
            ]:
                row[metric] = (sum(max(0, row[key] - old[key]) for key in fields) * scale / elapsed
                               if old and old['start'] == row['start'] else 0)
            previous[pid] = row
            processes.append(row)
        if not any(row['pid'] == args.pid for row in processes):
            raise SystemExit('Target process exited; measurement stopped')
        samples.append({'elapsed_seconds': index, 'processes': processes,
                        **{metric: sum(row[metric] for row in processes) for metric in [
                            'footprint_bytes', 'resident_bytes', 'cpu_percent', 'idle_wakeups_per_second',
                            'disk_read_bytes_per_second', 'disk_written_bytes_per_second']}})
        previous_time = start
        if index < args.seconds:
            time.sleep(max(0, 1 - (time.monotonic() - start)))
    steady = samples[1:]
    summary = {}
    for metric in ['footprint_bytes', 'resident_bytes', 'cpu_percent', 'idle_wakeups_per_second']:
        values = [row[metric] for row in steady]
        summary[metric] = {'mean': statistics.mean(values), 'median': statistics.median(values),
                           'p95': percentile(values, .95), 'max': max(values)}
    report = {'label': args.label, 'timestamp_utc': datetime.now(timezone.utc).isoformat(),
              'root_pid': args.pid, 'seconds': args.seconds, 'cpu_percent_basis': '100% = one CPU core',
              'attribution': 'responsibility_get_pid_responsible_for_pid',
              'summary': summary, 'samples': samples}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'label': args.label, 'summary': summary}, indent=2))


if __name__ == '__main__':
    main()
