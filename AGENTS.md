# Repository Guidelines

## Project Structure & Module Organization

- `src/backend.cpp`: C++ rpcd backend communicating with `lotus-hardware-service` over its Unix socket.
- `root/`: installed filesystem overlay, including the LuCI view in `www/luci-static/resources/view/status/lotus_hardware.js`, menu/ACL JSON, and the legacy-menu helper and templates.
- `po/zh_Hans/` and `po/templates/`: Chinese gettext catalog and translation template.
- `tests/`: backend, menu, UI, and optional device HTTP regression checks.
- `Makefile`, `sdk.config`, and `build-sdk.sh`: OpenWrt package definition and SDK build configuration. `docs/TEST_RESULTS.md` records validation evidence; `NOTICE` tracks dependencies and licenses.

## Build, Test, and Development Commands

- `sh test.sh`: runs Python backend/menu tests, Node.js UI assertions, and JavaScript/shell syntax checks.
- `HARDWARE_SERVICE_REPO=/path/to/lotus-mini-hardware-service sh test.sh`: selects the companion service repository. Tests require its built `build/lotus-hardwared` mock daemon, client headers, g++, Python 3, Node.js, and local Unix sockets.
- `sh build-sdk.sh /path/to/matching-openwrt-sdk`: builds the application APK into `artifacts/`. First build the hardware service in the matching AArch64 musl SDK to stage its headers. This script updates SDK configuration and package links.

The UI runs inside LuCI on OpenWrt; there is no standalone development server.

## Coding Style & Naming Conventions

Follow surrounding code: four-space indentation in C++, JavaScript, Python, and shell; tabs for Makefile recipes. Compile C++17 with `-Wall -Wextra -Werror`. Preserve snake_case RPC names and existing JavaScript naming. Use LuCI `_()` for user-facing Chinese strings and update both PO and POT entries. No dedicated formatter or linter configuration is present.

## Testing Guidelines

Python uses `unittest` with `test_*.py` files and `test_*` methods; UI checks use Node.js `assert` and `vm`. Add regressions for validation, read-only permissions, busy-resource protection, unavailable readings, and changed UI behavior. No numeric coverage threshold is configured. Device HTTP tests are opt-in and excluded from `test.sh`; document authorized device verification separately.

## Commit & Pull Request Guidelines

History uses concise imperative subjects such as “Add volume slider and state-aware service buttons.” Keep commits focused. PRs should explain behavior changes, report checks and prerequisites, link relevant issues, and include screenshots for visible UI changes. Distinguish mock results from device/browser verification.

## Security & Configuration

Keep RPC methods and executable arguments explicitly restricted, with separate read/write ACLs. Avoid direct hardware-node access, arbitrary commands, and application secrets. Preserve unknown legacy-menu edits and keep deployment configuration in the companion hardware service.
