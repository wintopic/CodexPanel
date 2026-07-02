#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const mode = process.argv[2] || 'build';
if (!['build', 'dev'].includes(mode)) {
  console.error('Usage: node scripts/run-tauri.js <build|dev>');
  process.exit(2);
}

const projectDir = path.resolve(__dirname, '..');
let command;
let args;

if (process.platform === 'win32') {
  command = 'powershell';
  args = [
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(projectDir, 'scripts', 'run-tauri-windows.ps1'),
    '-Mode',
    mode,
  ];
} else if (process.platform === 'linux') {
  command = 'bash';
  args = [path.join(projectDir, 'scripts', 'run-tauri-linux.sh'), mode];
} else {
  console.error(`Unsupported Tauri development platform for this wrapper: ${process.platform}`);
  process.exit(2);
}

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
