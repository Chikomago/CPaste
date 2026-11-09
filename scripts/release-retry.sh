#!/usr/bin/env bash
# Release operations are idempotent; retry temporary GitHub API failures.
retry() {
  local attempt
  for attempt in 1 2 3 4; do
    if "$@"; then
      return 0
    fi
    if test "$attempt" -lt 4; then
      echo "Release request failed; retry $attempt/3" >&2
      sleep "$(( ${RELEASE_RETRY_DELAY:-3} * attempt ))"
    fi
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  retry "$@"
fi
