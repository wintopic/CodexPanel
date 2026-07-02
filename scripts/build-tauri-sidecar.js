#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const script = isWindows
  ? path.join(projectDir, 'scripts', 'build-tauri-sidecar.ps1')
  : path.join(projectDir, 'scripts', 'build-tauri-sidecar-linux.sh');
const command = isWindows ? 'powershell' : 'bash';
const args = isWindows
  ? ['-ExecutionPolicy', 'Bypass', '-File', script]
  : [script];

const result = spawnSync(command, args, {
  cwd: projectDir,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
