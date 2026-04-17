#!/usr/bin/env bash
# Mock curl that reads from MOCK_CURL_RESPONSE_FILE and returns MOCK_CURL_HTTP_CODE.
# Parses --output and --write-out flags to mimic real curl behavior.

output_file=""
write_out=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --write-out)
      write_out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

http_code="${MOCK_CURL_HTTP_CODE:-200}"

# Write response body to --output file
if [[ -n "$output_file" && -n "${MOCK_CURL_RESPONSE_FILE:-}" ]]; then
  cp "$MOCK_CURL_RESPONSE_FILE" "$output_file"
elif [[ -n "$output_file" ]]; then
  echo '{}' > "$output_file"
fi

# Handle --write-out '%{http_code}'
if [[ "$write_out" == *"%{http_code}"* ]]; then
  printf '%s' "$http_code"
fi
