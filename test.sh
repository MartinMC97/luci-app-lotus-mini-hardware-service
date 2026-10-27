#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 tests/test_backend.py
python3 tests/test_menu.py
node tests/check-ui.js
node --check root/www/luci-static/resources/view/status/lotus_hardware.js
sh -n build-sdk.sh root/usr/libexec/lotus-hardware-ui-menu
