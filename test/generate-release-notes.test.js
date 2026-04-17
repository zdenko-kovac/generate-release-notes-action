const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'generate-release-notes.sh');
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const CURL_STUB = path.resolve(FIXTURES_DIR, 'curl-stub.sh');

function runScript(envOverrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-test-'));
  const outputFile = path.join(tmpDir, 'GITHUB_OUTPUT');
  const mockBinDir = path.join(tmpDir, 'bin');
  fs.writeFileSync(outputFile, '');
  fs.mkdirSync(mockBinDir);

  // Create a 'curl' symlink in mockBinDir pointing to our stub
  fs.symlinkSync(CURL_STUB, path.join(mockBinDir, 'curl'));

  const env = {
    PATH: `${mockBinDir}:${process.env.PATH}`,
    GITHUB_OUTPUT: outputFile,
    INPUT_PREVIOUS_TAG: 'v1.0.0',
    INPUT_NEW_TAG: 'v1.1.0',
    INPUT_TARGET_REF: 'main',
    INPUT_TOKEN: 'test-token',
    REPO: 'test-org/test-repo',
    API_URL: 'https://api.example.com',
    MOCK_CURL_HTTP_CODE: '200',
    MOCK_CURL_RESPONSE_FILE: path.join(FIXTURES_DIR, 'compare-mixed-commits.json'),
    ...envOverrides,
  };

  const result = spawnSync('/bin/bash', [SCRIPT_PATH], {
    env,
    timeout: 10000,
  });

  const rawOutput = fs.readFileSync(outputFile, 'utf8');
  const releaseNotes = parseReleaseNotes(rawOutput);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
    releaseNotes,
    rawOutput,
  };
}

function parseReleaseNotes(raw) {
  const startMarker = 'release-notes<<RELEASE_NOTES_EOF';
  const endMarker = 'RELEASE_NOTES_EOF';
  const startIdx = raw.indexOf(startMarker);
  if (startIdx === -1) return '';
  const contentStart = startIdx + startMarker.length + 1; // +1 for newline
  const endIdx = raw.indexOf(endMarker, contentStart);
  if (endIdx === -1) return raw.slice(contentStart);
  return raw.slice(contentStart, endIdx).replace(/\n$/, '');
}

// --- Tests ---

describe('first release handling', () => {
  test('empty INPUT_PREVIOUS_TAG produces Initial Release', () => {
    const { status, releaseNotes } = runScript({ INPUT_PREVIOUS_TAG: '' });
    assert.equal(status, 0);
    assert.match(releaseNotes, /## Initial Release v1\.1\.0/);
  });

  test('"v0.0.0" produces Initial Release', () => {
    const { status, releaseNotes } = runScript({ INPUT_PREVIOUS_TAG: 'v0.0.0' });
    assert.equal(status, 0);
    assert.match(releaseNotes, /## Initial Release v1\.1\.0/);
  });

  test('"0.0.0" produces Initial Release', () => {
    const { status, releaseNotes } = runScript({ INPUT_PREVIOUS_TAG: '0.0.0' });
    assert.equal(status, 0);
    assert.match(releaseNotes, /## Initial Release v1\.1\.0/);
  });

  test('new tag name appears in output', () => {
    const { releaseNotes } = runScript({
      INPUT_PREVIOUS_TAG: '',
      INPUT_NEW_TAG: 'v2.0.0',
    });
    assert.match(releaseNotes, /v2\.0\.0/);
  });
});

describe('API error handling', () => {
  test('HTTP 404 exits with code 1', () => {
    const { status, stdout, stderr } = runScript({
      MOCK_CURL_HTTP_CODE: '404',
      MOCK_CURL_RESPONSE_FILE: path.join(FIXTURES_DIR, 'compare-error.json'),
    });
    assert.equal(status, 1);
    assert.match(stdout, /::error::GitHub Compare API returned HTTP 404/);
    assert.match(stderr, /Not Found/);
  });

  test('HTTP 500 exits with code 1', () => {
    const { status, stdout } = runScript({
      MOCK_CURL_HTTP_CODE: '500',
      MOCK_CURL_RESPONSE_FILE: path.join(FIXTURES_DIR, 'compare-error.json'),
    });
    assert.equal(status, 1);
    assert.match(stdout, /::error::GitHub Compare API returned HTTP 500/);
  });
});

describe('zero commits', () => {
  test('empty commits array produces "no changes" message', () => {
    const { status, releaseNotes } = runScript({
      MOCK_CURL_RESPONSE_FILE: path.join(FIXTURES_DIR, 'compare-empty.json'),
    });
    assert.equal(status, 0);
    assert.match(releaseNotes, /no changes since v1\.0\.0/);
    assert.match(releaseNotes, /Release v1\.1\.0/);
  });

  test('all-filtered commits produce "no changes" message', () => {
    const { status, releaseNotes } = runScript({
      MOCK_CURL_RESPONSE_FILE: path.join(FIXTURES_DIR, 'compare-all-filtered.json'),
    });
    assert.equal(status, 0);
    assert.match(releaseNotes, /no changes/);
  });
});

describe('commit categorization', () => {
  test('feat commits appear under New Features', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /### 🚀 New Features/);
    assert.match(releaseNotes, /add OAuth2 support/);
  });

  test('fix commits appear under Bug Fixes', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /### 🐛 Bug Fixes/);
    assert.match(releaseNotes, /handle null response body/);
  });

  test('docs commits appear under Documentation', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /### 📄 Documentation/);
    assert.match(releaseNotes, /update API reference/);
  });

  test('breaking changes appear under Breaking Changes', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /### ⚠️ Breaking Changes/);
    assert.match(releaseNotes, /remove deprecated v1 endpoints/);
  });

  test('chore/refactor/perf commits appear under Improvements', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /### 🔧 Improvements/);
    assert.match(releaseNotes, /update dependencies/);
    assert.match(releaseNotes, /simplify query builder/);
    assert.match(releaseNotes, /optimize database queries/);
  });

  test('non-conventional commits appear under Other Changes', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /### Other Changes/);
    assert.match(releaseNotes, /Update README with examples/);
  });
});

describe('commit filtering', () => {
  test('bot commits are excluded', () => {
    const { releaseNotes } = runScript();
    assert.doesNotMatch(releaseNotes, /automated release/);
  });

  test('renovate bot commits are excluded', () => {
    const { releaseNotes } = runScript();
    assert.doesNotMatch(releaseNotes, /update dependency axios/);
  });

  test('merge commits are excluded', () => {
    const { releaseNotes } = runScript();
    assert.doesNotMatch(releaseNotes, /Merge pull request/);
  });

  test('"Bump version" commits are excluded', () => {
    const { releaseNotes } = runScript();
    assert.doesNotMatch(releaseNotes, /Bump version/);
  });

  test('only first line of multi-line messages is used', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /optimize database queries/);
    assert.doesNotMatch(releaseNotes, /connection pool/);
  });
});

describe('output structure', () => {
  test('starts with "## What\'s Changed"', () => {
    const { releaseNotes } = runScript();
    assert.match(releaseNotes, /^## What's Changed/);
  });

  test('each commit line includes a 7-char SHA', () => {
    const { releaseNotes } = runScript();
    // SHA is 7 chars in parentheses at end of line
    assert.match(releaseNotes, /\([a-z0-9]{7}\)/);
  });

  test('Full Changelog link is present with correct URL', () => {
    const { releaseNotes } = runScript();
    assert.match(
      releaseNotes,
      /\*\*Full Changelog\*\*: https:\/\/github\.tools\.sap\/test-org\/test-repo\/compare\/v1\.0\.0\.\.\.v1\.1\.0/
    );
  });

  test('sections with no commits are omitted', () => {
    // Use a fixture with only feat commits (create inline)
    const tmpFixture = path.join(os.tmpdir(), 'only-feat.json');
    fs.writeFileSync(tmpFixture, JSON.stringify({
      commits: [{
        sha: 'abcdef1234567890',
        commit: { author: { name: 'Dev' }, message: 'feat: add thing' },
      }],
    }));

    const { releaseNotes } = runScript({
      MOCK_CURL_RESPONSE_FILE: tmpFixture,
    });

    assert.match(releaseNotes, /### 🚀 New Features/);
    assert.doesNotMatch(releaseNotes, /### 🐛 Bug Fixes/);
    assert.doesNotMatch(releaseNotes, /### ⚠️ Breaking Changes/);
    assert.doesNotMatch(releaseNotes, /### 🔧 Improvements/);
    assert.doesNotMatch(releaseNotes, /### 📄 Documentation/);
    assert.doesNotMatch(releaseNotes, /### Other Changes/);

    fs.unlinkSync(tmpFixture);
  });

  test('GITHUB_OUTPUT uses heredoc delimiter pattern', () => {
    const { rawOutput } = runScript();
    assert.match(rawOutput, /release-notes<<RELEASE_NOTES_EOF/);
    assert.match(rawOutput, /RELEASE_NOTES_EOF/);
  });
});

describe('section ordering', () => {
  test('Breaking Changes appears before New Features', () => {
    const { releaseNotes } = runScript();
    const breakingIdx = releaseNotes.indexOf('Breaking Changes');
    const featuresIdx = releaseNotes.indexOf('New Features');
    assert.ok(breakingIdx < featuresIdx, 'Breaking Changes should precede New Features');
  });

  test('New Features appears before Bug Fixes', () => {
    const { releaseNotes } = runScript();
    const featuresIdx = releaseNotes.indexOf('New Features');
    const fixesIdx = releaseNotes.indexOf('Bug Fixes');
    assert.ok(featuresIdx < fixesIdx, 'New Features should precede Bug Fixes');
  });
});
