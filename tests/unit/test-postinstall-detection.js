#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const postinstallPath = path.join(__dirname, '..', '..', 'postinstall.js');

const scenarios = [
  {
    // Claude missing: exit 0, show CLI box, print note (graceful degradation)
    name: 'linux-claude-missing',
    platform: 'linux',
    mocks: { claude: 'fail' },
    expectExit: 0,
    expectStdout: /agentlint CLI is ready|CLI installed|Claude Code not found/i,
    expectStderr: /^$/,
  },
  {
    // Claude present, bundled installer fails: exit 1, show error
    name: 'darwin-claude-present-installer-fails',
    platform: 'darwin',
    mocks: { claude: 'ok', installer: 'fail' },
    expectExit: 1,
    expectStdout: /Configuring Claude Code plugin/i,
    expectStderr: /Installation failed: mock installer failed/i,
  },
  {
    // Windows, Claude missing: exit 0, graceful (CLI still usable)
    name: 'win32-claude-missing',
    platform: 'win32',
    mocks: { claude: 'fail' },
    expectExit: 0,
    expectStdout: /agentlint CLI is ready|CLI installed|Claude Code not found/i,
    expectStderr: /^$/,
  },
  {
    // Windows, Claude present, no bash: exit 1, install instructions
    name: 'win32-claude-present-bash-missing',
    platform: 'win32',
    mocks: { claude: 'ok', bash: 'fail' },
    expectExit: 1,
    expectStdout: /Git for Windows|WSL/is,
    expectStderr: /^$/,
  },
  {
    // Windows, Claude present, bash present, bundled installer fails: exit 1
    name: 'win32-claude-present-bash-present-installer-fails',
    platform: 'win32',
    mocks: { claude: 'ok', bash: 'ok', installer: 'fail' },
    expectExit: 1,
    expectStdout: /Configuring Claude Code plugin/i,
    expectStderr: /Installation failed: mock installer failed/i,
  },
];

const bootstrap = `
'use strict';
const childProcess = require('node:child_process');

const scenario = JSON.parse(process.env.AL_SCENARIO);

Object.defineProperty(process, 'platform', {
  value: scenario.platform,
  configurable: true,
});

childProcess.execSync = function mockExecSync(command) {
  const mocks = scenario.mocks || {};

  if (typeof command === 'string') {
    if (command === 'where claude' || command === 'command -v claude') {
      if (mocks.claude === 'fail') {
        const error = new Error('mock claude missing');
        error.status = 1;
        throw error;
      }
      return Buffer.from('stub-claude\\n');
    }

    if (command === 'bash --version') {
      if (mocks.bash === 'fail') {
        const error = new Error('mock bash missing');
        error.status = 127;
        throw error;
      }
      return Buffer.from('GNU bash, version 5.2.0\\n');
    }

    if (command.startsWith('bash ')) {
      if (mocks.installer === 'fail') {
        const error = new Error('mock installer failed');
        error.status = 1;
        throw error;
      }
      return Buffer.from('');
    }
  }

  throw new Error('unexpected execSync command: ' + command);
};

childProcess.execFileSync = function mockExecFileSync(file, args) {
  const mocks = scenario.mocks || {};

  if (file === 'bash' && Array.isArray(args) && args[0] && args[0].endsWith('install.sh')) {
    if (mocks.installer === 'fail') {
      const error = new Error('mock installer failed');
      error.status = 1;
      throw error;
    }
    return Buffer.from('');
  }

  throw new Error('unexpected execFileSync command: ' + file);
};

require(process.env.AL_POSTINSTALL);
`;

let passed = 0;

for (const scenario of scenarios) {
  const result = spawnSync(process.execPath, ['-e', bootstrap], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AL_POSTINSTALL: postinstallPath,
      AL_SCENARIO: JSON.stringify(scenario),
    },
  });

  try {
    assert.equal(
      result.status,
      scenario.expectExit,
      `expected exit ${scenario.expectExit}, got ${result.status}`
    );
    assert.match(result.stdout || '', scenario.expectStdout);
    assert.match(result.stderr || '', scenario.expectStderr);
    process.stdout.write(`PASS: ${scenario.name}\n`);
    passed += 1;
  } catch (error) {
    process.stdout.write(`FAIL: ${scenario.name}\n`);
    process.stdout.write(`${error.stack}\n`);
    process.stdout.write('stdout:\n');
    process.stdout.write(`${result.stdout || ''}\n`);
    process.stdout.write('stderr:\n');
    process.stdout.write(`${result.stderr || ''}\n`);
  }
}

process.stdout.write(`${passed}/${scenarios.length} scenarios passed\n`);
process.exit(passed === scenarios.length ? 0 : 1);
