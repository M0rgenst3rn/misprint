#!/bin/bash
# Installs MS Printer via Adobe's own plugin installer (UPIA),
# so Creative Cloud knows the plugin and doesn't drop it from the list again.
# Restart Photoshop afterwards: Plugins > MS Printer.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

rm -f "$HERE/dist/MS-Printer.ccx"
mkdir -p "$HERE/dist"
(cd "$HERE/printer" && zip -qr "$HERE/dist/MS-Printer.ccx" . -x '.*')

# only remove if already installed (otherwise the installer hangs)
if "$UPIA" --list all 2>/dev/null | grep -q "MS Printer"; then
  "$UPIA" --remove "MS Printer" >/dev/null 2>&1 || true
fi
"$UPIA" --install "$HERE/dist/MS-Printer.ccx"
echo "Done. Restart Photoshop > Plugins > MS Printer"
