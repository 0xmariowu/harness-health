#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const postinstallPath = path.join(__dirname, '..', '..', 'npm', 'postinstall.js');

const scenarios = [
  {
    name: 'linux-claude-missing',
    platform: 'linux',
    mocks: { claude: 'fail' },
    expectExit: 1,
    expectStdout: /^$/,
    expectStderr: /Claude Code not found/i,
  },
  {
    name: 'darwin-claude-present-download-fails',
    platform: 'darwin',
    mocks: { claude: 'ok', download: 'fail' },
    expectExit: 1,
    expectStdout: /Downloading AgentLint installer\.\.\./,
    expectStderr: /Installation failed: mock download failed/i,
  },
  {
    name: 'win32-claude-missing',
    platform: 'win32',
    mocks: { claude: 'fail' },
    expectExit: 1,
    expectStdout: /^$/,
    expectStderr: /Claude Code not found/i,
  },
  {
    name: 'win32-claude-present-bash-missing',
    platform: 'win32',
    mocks: { claude: 'ok', bash: 'fail' },
    expectExit: 1,
    expectStdout: /^$/,
    expectStderr: /Git for Windows.*WSL|WSL.*Git for Windows/is,
  },
  {
    name: 'win32-claude-present-bash-present-download-fails',
    platform: 'win32',
    mocks: { claude: 'ok', bash: 'ok', download: 'fail' },
    expectExit: 1,
    expectStdout: /Downloading AgentLint installer\.\.\./,
    expectStderr: /Installation failed: mock download failed/i,
  },
];

const bootstrap = `
'use strict';
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const https = require('node:https');

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

https.get = function mockGet(url, callback) {
  const request = new EventEmitter();

  process.nextTick(() => {
    const mocks = scenario.mocks || {};

    if (mocks.download === 'fail') {
      request.emit('error', new Error('mock download failed'));
      return;
    }

    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = {};
    callback(response);
    process.nextTick(() => {
      response.emit('data', Buffer.from('#!/usr/bin/env bash\\necho mocked\\n'));
      response.emit('end');
    });
  });

  return request;
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
