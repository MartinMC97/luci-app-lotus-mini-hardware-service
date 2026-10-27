#!/bin/sh
set -eu
[ "$#" = 1 ] || { echo 'usage: sh build-sdk.sh /path/to/sdk' >&2; exit 2; }
repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sdk=$(CDPATH= cd -- "$1" && pwd)
[ -f "$sdk/staging_dir/target-aarch64_generic_musl/usr/include/lotus-hardware/connection.h" ] || {
    echo 'Build lotus-hardware-service in this SDK first' >&2; exit 1;
}
ln -sfn "$repo" "$sdk/package/luci-app-lotus-mini-hardware-service"
cd "$sdk"
touch .config
./scripts/kconfig.pl + .config "$repo/sdk.config" > tmp/lotus-hardware-ui.config
cp tmp/lotus-hardware-ui.config .config
make defconfig
make -j2 package/luci-base/host/compile V=s
make -j2 package/luci-app-lotus-mini-hardware-service/compile CONFIG_AUTOREMOVE= V=s
mkdir -p "$repo/artifacts"
find bin/packages -name 'luci-app-lotus-mini-hardware-service-*.apk' -exec cp {} "$repo/artifacts/" \;
