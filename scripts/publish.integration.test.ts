/**
 * Exercises the release workflow's shell with a stub registry, independently
 * of npm credentials and without publishing a package.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'

const workflow = readFileSync(
  new URL('../.github/workflows/npm.yml', import.meta.url),
  'utf8',
)
const match = workflow.match(
  /- name: Publish release branches\n\s+shell: bash\n\s+run: \|\n((?: {10}.+\n)+)/,
)
assert.ok(match, 'Missing publish workflow script')
const script = match[1]
assert.ok(script, 'Missing publish workflow script body')

test('release workflow publishes only unpublished versions', async (t) => {
  const cases = [
    {
      name: 'existing version',
      versions: '["1.0.0","2.0.0"]',
      calls: ['view flash-store versions --json'],
    },
    {
      name: 'single existing version',
      versions: '"2.0.0"',
      calls: ['view flash-store versions --json'],
    },
    {
      name: 'new stable version',
      versions: '["1.0.0"]',
      calls: ['view flash-store versions --json', 'publish --tag latest'],
    },
    {
      name: 'prerelease branch',
      ref: 'refs/heads/v2.0',
      version: '2.1.0-rc.1',
      versions: '["2.0.0"]',
      calls: ['view flash-store versions --json', 'publish --tag next'],
    },
    { name: 'unrelated branch', ref: 'refs/heads/feature', calls: [] },
    {
      name: 'registry failure',
      viewStatus: '1',
      calls: ['view flash-store versions --json'],
      failure: true,
    },
    {
      name: 'invalid registry response',
      versions: '{}',
      calls: ['view flash-store versions --json'],
      failure: true,
    },
    {
      name: 'publish failure',
      versions: '[]',
      publishStatus: '1',
      calls: ['view flash-store versions --json', 'publish --tag latest'],
      failure: true,
    },
  ]

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const directory = mkdtempSync(join(tmpdir(), 'flash-publish-test-'))
      try {
        const calls = join(directory, 'calls')
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            name: 'flash-store',
            version: scenario.version ?? '2.0.0',
          }),
        )
        writeFileSync(
          join(directory, 'npm'),
          `#!/bin/sh
echo "$*" >> "$CALLS"
if [ "$1" = view ]; then
  printf '%s\\n' "$VERSIONS"
  exit "$VIEW_STATUS"
fi
exit "$PUBLISH_STATUS"
`,
          { mode: 0o755 },
        )
        const result = spawnSync(
          'bash',
          ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
          {
            cwd: directory,
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${directory}${delimiter}${process.env.PATH}`,
              GITHUB_REF: scenario.ref ?? 'refs/heads/main',
              CALLS: calls,
              VERSIONS: scenario.versions ?? '[]',
              VIEW_STATUS: scenario.viewStatus ?? '0',
              PUBLISH_STATUS: scenario.publishStatus ?? '0',
            },
          },
        )
        assert.equal(result.status === 0, !scenario.failure, result.stderr)
        assert.deepEqual(
          existsSync(calls)
            ? readFileSync(calls, 'utf8').trim().split('\n')
            : [],
          scenario.calls,
        )
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})
