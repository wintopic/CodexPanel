'use strict';

const crypto = require('crypto');
const path = require('path');

const token = process.env.MOBILE_TYPER_TOKEN || crypto.randomBytes(12).toString('base64url');
const port = Number(process.env.PORT || 8787);

process.env.MOBILE_TYPER_TOKEN = token;
process.env.PORT = String(port);
process.env.CODEX_APP_NAME = process.env.CODEX_APP_NAME || 'CodexPanel';
process.env.CODEX_OPEN_BROWSER = '0';

console.log(JSON.stringify({
  event: 'codexpanel-node-sidecar-starting',
  port,
  pid: process.pid,
}));

require(path.join(__dirname, 'server.js'));

process.on('SIGTERM', () => {
  process.exit(0);
});
