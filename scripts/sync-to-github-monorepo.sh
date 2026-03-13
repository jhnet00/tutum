#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

GITHUB_MONOREPO_REPO=${GITHUB_MONOREPO_REPO:-}
GITHUB_MONOREPO_TOKEN=${GITHUB_MONOREPO_TOKEN:-}
SYNC_SOURCE_PATH=${SYNC_SOURCE_PATH:-}
SYNC_TARGET_PATH=${SYNC_TARGET_PATH:-}
SYNC_COMPONENT_NAME=${SYNC_COMPONENT_NAME:-}
SYNC_BRANCH=${SYNC_BRANCH:-${CI_COMMIT_BRANCH:-}}
SYNC_ROOT_OWNER=${SYNC_ROOT_OWNER:-0}
SYNC_ROOT_PATHS=${SYNC_ROOT_PATHS:-}

[ -n "$GITHUB_MONOREPO_REPO" ] || { echo "ERROR: GITHUB_MONOREPO_REPO is missing"; exit 1; }
[ -n "$SYNC_SOURCE_PATH" ] || { echo "ERROR: SYNC_SOURCE_PATH is missing"; exit 1; }
[ -n "$SYNC_TARGET_PATH" ] || { echo "ERROR: SYNC_TARGET_PATH is missing"; exit 1; }
[ -n "$SYNC_COMPONENT_NAME" ] || { echo "ERROR: SYNC_COMPONENT_NAME is missing"; exit 1; }

case "$SYNC_BRANCH" in
  develop|main) ;;
  *)
    echo "Skip unsupported branch: $SYNC_BRANCH"
    exit 0
    ;;
esac

remote_url="$GITHUB_MONOREPO_REPO"
case "$remote_url" in
  https://*)
    [ -n "$GITHUB_MONOREPO_TOKEN" ] || { echo "ERROR: GITHUB_MONOREPO_TOKEN is missing"; exit 1; }
    remote_url="https://x-access-token:${GITHUB_MONOREPO_TOKEN}@${remote_url#https://}"
    ;;
esac

workdir=$(mktemp -d)
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT INT TERM

git clone --depth 1 --branch "$SYNC_BRANCH" "$remote_url" "$workdir/mono"
cd "$workdir/mono"

git config user.email "ci@tutum.dev"
git config user.name "GitLab CI"

if [ "$SYNC_ROOT_OWNER" = "1" ]; then
  find . -mindepth 1 -maxdepth 1 \
    ! -name '.git' \
    ! -name '.github' \
    ! -name '.gitignore' \
    ! -name 'README.md' \
    ! -name 'backend' \
    ! -name 'frontend' \
    ! -name 'auth' \
    -exec rm -rf {} +

  cat > README.md <<'EOF'
# clouddx-project

GitHub monorepo mirror for portfolio/reference use.

Source of truth is GitLab.
Do not commit directly here.

Mapped repositories:
- backend -> `backend/`
- frontend -> `frontend/`
- auth -> `auth/`
EOF

  cat > .gitignore <<'EOF'
node_modules/
.next/
__pycache__/
.pytest_cache/
.venv/
*.pyc
*.pyo
EOF
fi

if [ -n "$SYNC_ROOT_PATHS" ]; then
  old_ifs=$IFS
  IFS=','
  for root_path in $SYNC_ROOT_PATHS; do
    IFS=$old_ifs
    root_path=$(printf '%s' "$root_path" | sed 's#^[[:space:]]*##;s#[[:space:]]*$##')
    [ -n "$root_path" ] || continue

    src_root="$REPO_ROOT/$root_path"
    if [ ! -d "$src_root" ]; then
      echo "ERROR: root sync source directory not found: $src_root"
      exit 1
    fi

    mkdir -p "$root_path"
    find "$root_path" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

    tar \
      --exclude='.git' \
      --exclude='.github' \
      --exclude='.gitlab-ci.yml' \
      --exclude='.idea' \
      --exclude='.vscode' \
      --exclude='node_modules' \
      --exclude='.next' \
      --exclude='.cache' \
      --exclude='.logs' \
      --exclude='__pycache__' \
      --exclude='.pytest_cache' \
      --exclude='.venv' \
      --exclude='*.pyc' \
      --exclude='*.pyo' \
      --exclude='tsconfig.tsbuildinfo' \
      -C "$src_root" -cf - . | tar -C "$root_path" -xf -

    IFS=','
  done
  IFS=$old_ifs
fi

mkdir -p "$SYNC_TARGET_PATH"
find "$SYNC_TARGET_PATH" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

src_dir="$REPO_ROOT/$SYNC_SOURCE_PATH"
[ -d "$src_dir" ] || { echo "ERROR: source directory not found: $src_dir"; exit 1; }

tar \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.gitlab-ci.yml' \
  --exclude='.idea' \
  --exclude='.vscode' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.cache' \
  --exclude='.logs' \
  --exclude='__pycache__' \
  --exclude='.pytest_cache' \
  --exclude='.venv' \
  --exclude='*.pyc' \
  --exclude='*.pyo' \
  --exclude='tsconfig.tsbuildinfo' \
  -C "$src_dir" -cf - . | tar -C "$SYNC_TARGET_PATH" -xf -

if ! git status --porcelain | grep -q .; then
  echo "No monorepo changes for $SYNC_COMPONENT_NAME"
  exit 0
fi

git add -A
git commit -m "sync(${SYNC_COMPONENT_NAME}): ${CI_PROJECT_PATH:-local}@${CI_COMMIT_SHORT_SHA:-manual}"

attempt=1
while [ "$attempt" -le 5 ]; do
  if git push origin "HEAD:${SYNC_BRANCH}"; then
    echo "Sync push succeeded on attempt $attempt"
    exit 0
  fi

  echo "Push rejected, retrying with rebase (attempt $attempt)"
  git fetch origin "$SYNC_BRANCH"
  if ! git rebase "origin/$SYNC_BRANCH"; then
    git rebase --abort || true
    exit 1
  fi
  attempt=$((attempt + 1))
done

echo "ERROR: failed to push sync after retries"
exit 1
