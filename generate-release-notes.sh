#!/usr/bin/env bash
set -euo pipefail

# Handle first release (no previous tag or v0.0.0)
if [[ -z "$INPUT_PREVIOUS_TAG" || "$INPUT_PREVIOUS_TAG" == "v0.0.0" || "$INPUT_PREVIOUS_TAG" == "0.0.0" ]]; then
  notes="## Initial Release ${INPUT_NEW_TAG}"
  echo "release-notes<<RELEASE_NOTES_EOF" >> "$GITHUB_OUTPUT"
  echo "$notes" >> "$GITHUB_OUTPUT"
  echo "RELEASE_NOTES_EOF" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Fetch commits between previous tag and target ref via Compare API
http_code=$(
  curl --silent --output /tmp/compare_response.json --write-out '%{http_code}' \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${INPUT_TOKEN}" \
    "${API_URL}/repos/${REPO}/compare/${INPUT_PREVIOUS_TAG}...${INPUT_TARGET_REF}"
)

if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
  echo "::error::GitHub Compare API returned HTTP ${http_code}"
  cat /tmp/compare_response.json >&2
  exit 1
fi

compare_response=$(cat /tmp/compare_response.json)

# Extract commit messages and SHAs, filter out bot and merge commits
commits=$(echo "$compare_response" | jq -r '
  .commits // []
  | map(select(
      (.commit.author.name != "cs-devops-gh-actions-serviceuser") and
      (.commit.author.name != "ospo-renovate[bot]") and
      (.commit.message | test("^Merge (pull request|branch)") | not) and
      (.commit.message | test("^Bump version") | not)
  ))
  | map({
      sha: .sha[0:7],
      message: (.commit.message | split("\n") | .[0])
  })
')

commit_count=$(echo "$commits" | jq 'length')

# Handle zero commits
if [[ "$commit_count" -eq 0 ]]; then
  notes="Release ${INPUT_NEW_TAG} -- no changes since ${INPUT_PREVIOUS_TAG}"
  echo "release-notes<<RELEASE_NOTES_EOF" >> "$GITHUB_OUTPUT"
  echo "$notes" >> "$GITHUB_OUTPUT"
  echo "RELEASE_NOTES_EOF" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Categorize commits
breaking=""
features=""
fixes=""
improvements=""
docs=""
other=""

while IFS= read -r commit_json; do
  message=$(echo "$commit_json" | jq -r '.message')
  sha=$(echo "$commit_json" | jq -r '.sha')

  # Check for breaking changes (! before colon in conventional commits)
  if [[ "$message" =~ ^[a-z]+(\(.+\))?!:\ (.+)$ ]]; then
    description="${BASH_REMATCH[2]}"
    breaking="${breaking}- ${description} (${sha})\n"
  elif [[ "$message" =~ ^feat(\(.+\))?:\ (.+)$ ]]; then
    description="${BASH_REMATCH[2]}"
    features="${features}- ${description} (${sha})\n"
  elif [[ "$message" =~ ^fix(\(.+\))?:\ (.+)$ ]]; then
    description="${BASH_REMATCH[2]}"
    fixes="${fixes}- ${description} (${sha})\n"
  elif [[ "$message" =~ ^docs(\(.+\))?:\ (.+)$ ]]; then
    description="${BASH_REMATCH[2]}"
    docs="${docs}- ${description} (${sha})\n"
  elif [[ "$message" =~ ^(perf|refactor|chore|ci|build|style|test|revert)(\(.+\))?:\ (.+)$ ]]; then
    description="${BASH_REMATCH[3]}"
    improvements="${improvements}- ${description} (${sha})\n"
  else
    # Non-conventional commit: use the full message
    other="${other}- ${message} (${sha})\n"
  fi
done < <(echo "$commits" | jq -c '.[]')

# Build the release notes
notes="## What's Changed\n"

if [[ -n "$breaking" ]]; then
  notes="${notes}\n### ⚠️ Breaking Changes\n${breaking}"
fi

if [[ -n "$features" ]]; then
  notes="${notes}\n### 🚀 New Features\n${features}"
fi

if [[ -n "$fixes" ]]; then
  notes="${notes}\n### 🐛 Bug Fixes\n${fixes}"
fi

if [[ -n "$improvements" ]]; then
  notes="${notes}\n### 🔧 Improvements\n${improvements}"
fi

if [[ -n "$docs" ]]; then
  notes="${notes}\n### 📄 Documentation\n${docs}"
fi

if [[ -n "$other" ]]; then
  notes="${notes}\n### Other Changes\n${other}"
fi

notes="${notes}\n**Full Changelog**: https://github.tools.sap/${REPO}/compare/${INPUT_PREVIOUS_TAG}...${INPUT_NEW_TAG}"

# Write multi-line output
echo "release-notes<<RELEASE_NOTES_EOF" >> "$GITHUB_OUTPUT"
echo -e "$notes" >> "$GITHUB_OUTPUT"
echo "RELEASE_NOTES_EOF" >> "$GITHUB_OUTPUT"
