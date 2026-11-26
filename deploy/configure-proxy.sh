#!/usr/bin/env bash
set -euo pipefail

fragment=$1
backup=$2
config=/etc/caddy/Caddyfile
candidate=$(mktemp)
trap 'rm -f -- "$candidate"' EXIT

python3 - "$config" "$fragment" > "$candidate" <<'PY'
import re
import sys
from pathlib import Path

current = Path(sys.argv[1]).read_text()
wanted = Path(sys.argv[2]).read_text()

for host in ('app.geniebox.ru', 'api.geniebox.ru'):
    block = re.compile(r'^' + re.escape(host) + r' \{\n.*?^\}$', re.M | re.S)
    replacement = block.findall(wanted)
    if len(replacement) != 1:
        raise SystemExit(f'Expected exactly one deployment block for {host}')
    current, count = block.subn(lambda _: replacement[0], current)
    if count != 1:
        raise SystemExit(f'Expected exactly one installed block for {host}')

sys.stdout.write(current)
PY

if cmp -s "$candidate" "$config"; then
  exit 0
fi

sudo caddy validate --config "$candidate" --adapter caddyfile
cp -- "$config" "$backup"
sudo install -m 0644 -- "$candidate" "$config"
sudo systemctl reload caddy
