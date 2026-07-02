#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const buildDir = path.join(projectDir, '.build', 'wails-sidecar');
const payloadDir = path.join(buildDir, 'payload');
const binDir = path.join(projectDir, 'build', 'bin');
const sidecarName = process.platform === 'win32' ? 'codexpanel-node-sidecar.exe' : 'codexpanel-node-sidecar';
const sidecarPath = path.join(binDir, sidecarName);

function assertInsideWorkspace(target) {
  const resolvedProject = path.resolve(projectDir);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedProject, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to operate outside workspace: ${resolvedTarget}`);
  }
}

function removeDir(target) {
  assertInsideWorkspace(target);
  fs.rmSync(target, { recursive: true, force: true });
}

function copyFile(relativePath) {
  fs.copyFileSync(path.join(projectDir, relativePath), path.join(payloadDir, path.basename(relativePath)));
}

function copyDir(relativePath) {
  const from = path.join(projectDir, relativePath);
  const to = path.join(payloadDir, path.basename(relativePath));
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function payloadHash() {
  const signature = walkFiles(payloadDir)
    .sort((a, b) => a.localeCompare(b))
    .map(file => {
      const relative = path.relative(payloadDir, file).replace(/\\/g, '/');
      return `${relative}=${sha256File(file)}`;
    })
    .join('\n');
  return crypto.createHash('sha256').update(signature).digest('hex').slice(0, 12);
}

function ensureNoSecrets() {
  const forbiddenNames = new Set(['state.json', '.env', '.env.local', '.env.production']);
  const forbidden = walkFiles(payloadDir).filter(file => {
    const parts = path.relative(payloadDir, file).split(path.sep);
    return parts.includes('.codex') || forbiddenNames.has(path.basename(file));
  });
  if (forbidden.length) {
    throw new Error(`Refusing to bundle user secrets or local state files:${os.EOL}${forbidden.join(os.EOL)}`);
  }
}

function run(command, args, options = {}) {
  let spawnCommand = command;
  let spawnArgs = args;
  if (process.platform === 'win32' && command.endsWith('.cmd')) {
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    spawnCommand = process.env.ComSpec || 'cmd.exe';
    spawnArgs = ['/d', '/s', '/c', [quote(command), ...args.map(quote)].join(' ')];
  }

  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: projectDir,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function findNpxCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(path.dirname(nodeDir), 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Unable to locate npx-cli.js. Checked:${os.EOL}${candidates.join(os.EOL)}`);
  }
  return found;
}

removeDir(buildDir);
fs.mkdirSync(payloadDir, { recursive: true });
fs.mkdirSync(binDir, { recursive: true });
fs.rmSync(sidecarPath, { force: true });

run('node', ['--check', path.join(projectDir, 'server.js')]);
run('node', ['--check', path.join(projectDir, 'windows', 'node-sidecar.js')]);

copyFile('package.json');
copyFile('server.js');
copyDir('public');
copyDir('bin');
fs.copyFileSync(path.join(projectDir, 'windows', 'node-sidecar.js'), path.join(payloadDir, 'node-sidecar.js'));
ensureNoSecrets();

const identifier = `codexpanel-wails-node-sidecar-${payloadHash()}`;
run(process.execPath, [
  findNpxCli(),
  '--yes',
  'caxa',
  '--input',
  payloadDir,
  '--output',
  sidecarPath,
  '--no-dedupe',
  '--identifier',
  identifier,
  '--uncompression-message',
  'Preparing CodexPanel local service...',
  '--',
  '{{caxa}}/node_modules/.bin/node',
  '{{caxa}}/node-sidecar.js',
]);

if (!fs.existsSync(sidecarPath)) {
  throw new Error(`Sidecar build did not create expected executable: ${sidecarPath}`);
}

if (process.platform !== 'win32') fs.chmodSync(sidecarPath, 0o755);

const size = fs.statSync(sidecarPath).size / 1024 / 1024;
console.log(`Built Wails sidecar: ${sidecarPath}`);
console.log(`Size: ${size.toFixed(1)} MB`);
