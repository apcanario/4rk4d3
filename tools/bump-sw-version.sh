#!/bin/sh
# Bump the service worker cache version (sw.js VERSION = 'rlx-vN' -> 'rlx-vN+1').
# Run before every deploy that changes a shipped file. Not part of the runtime.
set -eu
cd "$(dirname "$0")/.."
cur=$(sed -n "s/^const VERSION = 'rlx-v\([0-9]*\)';$/\1/p" sw.js)
[ -n "$cur" ] || { echo "VERSION line not found in sw.js" >&2; exit 1; }
next=$((cur + 1))
sed -i.bak "s/^const VERSION = 'rlx-v$cur';$/const VERSION = 'rlx-v$next';/" sw.js && rm -f sw.js.bak
echo "sw.js VERSION rlx-v$cur -> rlx-v$next"
