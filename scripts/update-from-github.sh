#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: scripts/update-from-github.sh [options] <github_owner/repo> [branch]

Adds or updates a remote (default: `upstream`) pointing at the given GitHub
repository, fetches the specified branch (default: main), and fast-forwards the
current branch to match it.

Options:
  --base-url <url>     Override the GitHub base URL (defaults to $GITHUB_BASE_URL or https://github.com)
  --remote-name <name> Use a remote name other than "upstream"
  --branch <branch>    Explicitly set the branch to fetch (overrides the positional [branch])
  -h, --help           Show this message

The script requires network access to the configured GitHub host (or mirror).
USAGE
}

BRANCH="main"
REMOTE_NAME="upstream"
BASE_URL="${GITHUB_BASE_URL:-https://github.com}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      [[ $# -lt 2 ]] && { echo "Missing value for --base-url" >&2; usage; exit 1; }
      BASE_URL="$2"
      shift 2
      ;;
    --remote-name)
      [[ $# -lt 2 ]] && { echo "Missing value for --remote-name" >&2; usage; exit 1; }
      REMOTE_NAME="$2"
      shift 2
      ;;
    --branch|-b)
      [[ $# -lt 2 ]] && { echo "Missing value for --branch" >&2; usage; exit 1; }
      BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

REPO_SLUG="$1"
shift

if [[ $# -gt 0 ]]; then
  BRANCH="$1"
  shift
fi

if [[ $# -gt 0 ]]; then
  echo "Unexpected argument: $1" >&2
  usage
  exit 1
fi

trimmed_base="${BASE_URL%/}"
if [[ "$trimmed_base" != http://* && "$trimmed_base" != https://* ]]; then
  trimmed_base="https://${trimmed_base}"
fi
REMOTE_URL="${trimmed_base}/${REPO_SLUG}.git"

if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  current_url="$(git remote get-url "$REMOTE_NAME")"
  if [[ "$current_url" != "$REMOTE_URL" ]]; then
    echo "Updating $REMOTE_NAME remote URL from $current_url to $REMOTE_URL" >&2
    git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
  fi
else
  echo "Adding $REMOTE_NAME remote -> $REMOTE_URL" >&2
  git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

echo "Fetching $BRANCH from $REMOTE_URL" >&2
if git fetch "$REMOTE_NAME" "$BRANCH"; then
  echo "Fast-forwarding $(git rev-parse --abbrev-ref HEAD) to $REMOTE_NAME/$BRANCH" >&2
  if ! git merge --ff-only "$REMOTE_NAME/$BRANCH"; then
    cat <<'ERROR' >&2
Fast-forward failed.
Resolve conflicts manually, then run:
  git merge "$REMOTE_NAME/$BRANCH"
ERROR
    exit 1
  fi

  echo "Repository is now aligned with $REMOTE_NAME/$BRANCH" >&2
  exit 0
fi

fetch_err=$?

cat <<'ERROR' >&2
Failed to fetch from the configured GitHub host using git.

If you are behind a firewall or GitHub is blocked, try specifying an alternate
mirror with --base-url or the GITHUB_BASE_URL environment variable.

Attempting to download a tarball archive as a fallback...
ERROR

ARCHIVE_URL="${trimmed_base}/${REPO_SLUG}/archive/refs/heads/${BRANCH}.tar.gz"
if [[ -n "${SEA_STYLE_ARCHIVE:-}" ]]; then
  ARCHIVE_URL="${SEA_STYLE_ARCHIVE}"
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE_PATH="$TMP_DIR/archive.tar.gz"
if [[ -f "$ARCHIVE_URL" ]]; then
  cp "$ARCHIVE_URL" "$ARCHIVE_PATH"
else
  if ! curl -L --fail --proto '=https' --tlsv1.2 -o "$ARCHIVE_PATH" "$ARCHIVE_URL"; then
    cat <<ERROR >&2
Failed to download archive from $ARCHIVE_URL.

If direct downloads are blocked, manually download the tarball and point the
SEA_STYLE_ARCHIVE environment variable to the local file:

  SEA_STYLE_ARCHIVE=/path/to/archive.tar.gz \
    scripts/update-from-github.sh $REPO_SLUG $BRANCH

Ensure the target host exposes archives compatible with GitHub's
`/archive/refs/heads/<branch>.tar.gz` structure.
ERROR
    exit "$fetch_err"
  fi
fi

extract_dir="$TMP_DIR/extracted"
mkdir -p "$extract_dir"
if ! tar -xzf "$ARCHIVE_PATH" -C "$extract_dir"; then
  echo "Failed to extract archive $ARCHIVE_PATH" >&2
  exit 1
fi

top_level_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "$top_level_dir" ]]; then
  echo "Archive extraction did not yield a repository directory" >&2
  exit 1
fi

echo "Applying archive contents from $ARCHIVE_URL" >&2
rsync -a --delete --exclude '.git/' "$top_level_dir/" .

cat <<'INFO' >&2
Working tree updated from archive. Review the changes with:
  git status

Commit the updates to record the new snapshot.
INFO
