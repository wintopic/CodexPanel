#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] || 'build';
const args = rawArgs.length ? [...rawArgs] : ['build', '-clean'];
const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));

function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function pathCandidates() {
  const names = process.platform === 'win32'
    ? ['wails.exe', 'wails.cmd', 'wails.bat']
    : ['wails'];
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(os.homedir(), 'go', 'bin'),
  ].filter(Boolean);

  const candidates = [];
  for (const dir of dirs) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  return candidates;
}

function findWails() {
  if (process.env.WAILS_BIN && exists(process.env.WAILS_BIN)) {
    return process.env.WAILS_BIN;
  }
  const found = pathCandidates().find(exists);
  if (!found) {
    throw new Error('Unable to find Wails CLI. Install it with: go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0');
  }
  return found;
}

function extraToolPaths(wailsPath) {
  const dirs = [
    path.dirname(wailsPath),
    path.join(os.homedir(), 'go', 'bin'),
    process.env.GOROOT ? path.join(process.env.GOROOT, 'bin') : '',
    process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Go', 'bin') : '',
    '/usr/local/go/bin',
    '/opt/homebrew/bin',
  ].filter(Boolean);

  const unique = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    if (!unique.some(existing => existing.toLowerCase() === dir.toLowerCase())) unique.push(dir);
  }
  return unique;
}

if (process.platform === 'linux' && (command === 'build' || command === 'dev') && !args.includes('-tags')) {
  args.push('-tags', 'webkit2_41');
}

if ((command === 'build' || command === 'dev') && !args.includes('-ldflags')) {
  args.push('-ldflags', `-X main.appVersion=${packageJson.version}`);
}

const wails = findWails();
const env = { ...process.env };
const originalPath = env.PATH || env.Path || '';
env.PATH = [...extraToolPaths(wails), originalPath].join(path.delimiter);
if (process.platform === 'win32') env.Path = env.PATH;

const result = spawnSync(wails, args, {
  cwd: projectDir,
  stdio: 'inherit',
  shell: false,
  env,
});

if (result.error) throw result.error;
process.exit(result.status || 0);
