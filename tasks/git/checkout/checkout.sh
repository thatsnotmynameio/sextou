#!/bin/sh
# Clones CHECKOUT_REPO (owner/name) from CHECKOUT_SERVER, an https URL, at
# CHECKOUT_REF into CHECKOUT_PATH inside CHECKOUT_WORKSPACE: a shallow fetch
# of that one ref, checked out detached. Taskfile.yml sets each variable from
# the task's context.
#
# Exits with 2 on an input it refuses, before it runs git, so the workspace
# stays as it was; with 127 when git isn't on the PATH; else with git's own
# code.
set -eu

refuse() {
  echo "checkout: $1" >&2
  exit 2
}

# A part of owner/name: letters, digits, _, . and -, but neither . nor ..,
# which the URL would resolve to another path. The same rule as the server's
# for a claim's repository.
part() {
  case $1 in
  '' | . | .. | *[!A-Za-z0-9_.-]*) return 1 ;;
  esac
}

repo=$CHECKOUT_REPO
case $repo in
*/*) owner=${repo%%/*} name=${repo#*/} ;;
*) owner='' name='' ;;
esac
part "$owner" && part "$name" || refuse 'repo is owner/name'

# One that starts with - would reach git fetch as an option, and one with : or
# * is a refspec, which fetches other refs and writes them.
case $CHECKOUT_REF in
'' | -* | *[:*]* | *[[:space:]]*) refuse 'ref is a commit, a branch or a tag' ;;
esac

case $CHECKOUT_PATH in
/* | .. | ../* | */.. | */../*) refuse 'path is inside the workspace' ;;
esac

# Only https: file:// would reach the repositories on the runner's own disk,
# http:// travels unencrypted, and git's ext:: runs a command.
case $CHECKOUT_SERVER in
https://*) ;;
*) refuse 'server is an https URL' ;;
esac

if ! command -v git >/dev/null 2>&1; then
  echo 'checkout: git is not on the PATH' >&2
  exit 127
fi

# A repository that asks for credentials fails at once instead of waiting on
# a prompt no one answers: no secret comes from the server.
export GIT_TERMINAL_PROMPT=0
dest=$CHECKOUT_WORKSPACE/$CHECKOUT_PATH
mkdir -p "$dest"
git -C "$dest" init -q
git -C "$dest" remote add origin "$CHECKOUT_SERVER/$repo"
git -C "$dest" fetch -q --depth 1 --no-tags origin "$CHECKOUT_REF"
git -C "$dest" checkout -q --detach FETCH_HEAD
