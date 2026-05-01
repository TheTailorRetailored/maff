#!/bin/sh
set -eu

ELAN_HOME="${ELAN_HOME:-/root/.elan}"
LEAN_TOOLCHAIN="${LEAN_TOOLCHAIN:-leanprover/lean4:stable}"

mkdir -p "$ELAN_HOME"

if [ ! -x "$ELAN_HOME/bin/elan" ]; then
  echo "Bootstrapping elan into $ELAN_HOME" >&2
  rm -rf "$ELAN_HOME/bin" "$ELAN_HOME/env" "$ELAN_HOME/settings.toml" "$ELAN_HOME/tmp" "$ELAN_HOME/toolchains"
  curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh -s -- -y --default-toolchain "$LEAN_TOOLCHAIN"
fi

"$ELAN_HOME/bin/elan" default "$LEAN_TOOLCHAIN" >/dev/null 2>&1

if ! "$ELAN_HOME/bin/elan" which lake >/dev/null 2>&1; then
  echo "Installing Lean toolchain $LEAN_TOOLCHAIN into $ELAN_HOME" >&2
  "$ELAN_HOME/bin/elan" toolchain install "$LEAN_TOOLCHAIN" >/dev/null
fi

ln -sf "$ELAN_HOME/bin/lake" /usr/local/bin/lake
ln -sf "$ELAN_HOME/bin/lean" /usr/local/bin/lean

"$ELAN_HOME/bin/lake" --version >/dev/null

exec "$@"
