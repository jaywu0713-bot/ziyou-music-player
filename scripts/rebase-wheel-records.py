"""Preserve runtime integrity checks after PyInstaller rewrites/signs Mach-O files."""
import base64
import csv
import hashlib
from pathlib import Path
import sys


def rebase_records(root):
    root = Path(root).resolve()
    for record in root.glob('*.dist-info/RECORD'):
        with record.open(newline='') as source:
            rows = list(csv.reader(source))
        for row in rows:
            if not row or '..' in Path(row[0]).parts or Path(row[0]).is_absolute():
                continue
            path = (root / row[0]).resolve()
            if path.is_relative_to(root) and path.is_file() and path.suffix in ('.so', '.dylib'):
                data = path.read_bytes()
                digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('=')
                row[1:] = ['sha256=' + digest, str(len(data))]
        with record.open('w', newline='') as target:
            csv.writer(target).writerows(rows)


if __name__ == '__main__':
    rebase_records(sys.argv[1])
