#!/usr/bin/env node
'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const APP_NAME = process.env.CODEX_APP_NAME || 'CodexPanel';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const STATE_DIR = process.env.CODEX_STATE_DIR || path.join(os.homedir(), '.codex');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const STARTUP_CONTROL_CONFIG = readStartupControlConfig();
const TOKEN = process.env.MOBILE_TYPER_TOKEN || crypto.randomBytes(12).toString('base64url');
const REMOTE_ACCESS_KEY = normalizeRemoteAccessKey(process.env.CODEX_REMOTE_KEY || STARTUP_CONTROL_CONFIG.remoteKey || '');
const RELAY_URL = String(process.env.CODEX_RELAY_URL || STARTUP_CONTROL_CONFIG.relayUrl || '').trim().replace(/\/+$/, '');
const RELAY_DEVICE_ID = String(process.env.CODEX_RELAY_DEVICE_ID || defaultRelayDeviceId()).trim();
const RELAY_LOCAL_BASE = String(process.env.CODEX_RELAY_LOCAL_BASE || `http://127.0.0.1:${PORT}`).trim().replace(/\/+$/, '');
const RELAY_AGENT_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CODEX_RELAY_CONCURRENCY || 1)));
const RELAY_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.CODEX_RELAY_REQUEST_TIMEOUT_MS || 70000));
const RELAY_POLL_TIMEOUT_MS = Math.max(10000, Number(process.env.CODEX_RELAY_POLL_TIMEOUT_MS || 35000));
const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = Number(process.env.CODEX_MAX_BODY_BYTES || 28 * 1024 * 1024);
const MAX_TEXT_LENGTH = 8000;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = Number(process.env.CODEX_MAX_ATTACHMENT_BYTES || 8 * 1024 * 1024);
const UPLOAD_DIR = path.join(os.tmpdir(), 'codex-uploads');
const OPEN_BROWSER_ON_START = process.argv.includes('--open') || /^(1|true|yes)$/i.test(process.env.CODEX_OPEN_BROWSER || '');

const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CODEX_SESSION_INDEX = path.join(os.homedir(), '.codex', 'session_index.jsonl');
const CODEX_DESKTOP_LOGS_DIR = path.join(os.homedir(), 'Library', 'Logs', 'com.openai.codex');
const CODEX_SESSION_TAIL_BYTES = 5 * 1024 * 1024;
const CODEX_ACTIVITY_TAIL_BYTES = 512 * 1024;
const CODEX_ACTIVITY_LOOKBACK_BYTES = CODEX_SESSION_TAIL_BYTES;
const CODEX_RUNTIME_STALE_MS = 2 * 60 * 60 * 1000;
const CODEX_HISTORY_TAIL_BYTES = 128 * 1024 * 1024;
const CODEX_TITLE_SCAN_BYTES = 12 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 120;
const CODEX_TAIL_CACHE_MAX_BYTES = 12 * 1024 * 1024;
const CODEX_HISTORY_RESPONSE_CACHE_MS = 15000;
const GUI_FAILURE_REPORT_LIMIT = 80;
const GUI_FAILURE_LOG_SCAN_BYTES = 2 * 1024 * 1024;
const GUI_FAILURE_LOG_RECENT_MS = 15 * 60 * 1000;
const RECENT_SEND_TTL_MS = 5 * 60 * 1000;
const CODEX_THREAD_SYNC_FRESH_MS = 5000;
const CODEX_DEEPLINK_SETTLE_MS = 560;
const CODEX_APP_FOCUS_SETTLE_MS = 100;
const CODEX_CLICK_SETTLE_MS = 60;
const TEXT_PASTE_SETTLE_MS = 140;
const ATTACHMENT_PASTE_SETTLE_MS = 220;
const CODEX_COMMAND_SETTLE_MS = 180;
const CODEX_MODEL_COMMAND_SETTLE_MS = 450;
const CODEX_REASONING_COMMAND_SETTLE_MS = 450;
const CODEX_SESSION_FILE_CACHE_MS = 1200;
const CODEX_THREAD_LIST_CACHE_MS = 1200;
const CODEX_HISTORY_INITIAL_TAIL_BYTES = 8 * 1024 * 1024;
const REASONING_MODE_TARGETS = {
  low: { key: 'low', value: 'low', label: '低', displayName: '低' },
  medium: { key: 'medium', value: 'medium', label: '中', displayName: '中' },
  high: { key: 'high', value: 'high', label: '高', displayName: '高' },
  xhigh: { key: 'xhigh', value: 'xhigh', label: '超高', displayName: '超高' },
};
const DEFAULT_MODEL_OPTIONS = [
  { key: 'gpt-5.5', id: 'gpt-5.5', label: '5.5', displayName: 'GPT-5.5', source: 'official' },
  { key: 'gpt-5.4', id: 'gpt-5.4', label: '5.4', displayName: 'GPT-5.4', source: 'official' },
  { key: 'gpt-5.4-mini', id: 'gpt-5.4-mini', label: 'mini', displayName: 'GPT-5.4-Mini', source: 'official' },
  { key: 'gpt-5.3-codex', id: 'gpt-5.3-codex', label: '5.3', displayName: 'GPT-5.3-Codex', source: 'official' },
  { key: 'gpt-5.2', id: 'gpt-5.2', label: '5.2', displayName: 'GPT-5.2', source: 'official' },
];
const CODEX_APP_SLASH_COMMANDS = new Set(['/feedback', '/goal', '/init', '/mcp', '/plan', '/review', '/status']);
const CODEX_REMOTE_SAFE_SLASH_COMMANDS = new Set([
  ...CODEX_APP_SLASH_COMMANDS,
  '/apps',
  '/fast',
  '/hooks',
  '/memories',
  '/plugins',
  '/skills',
]);
const CODEX_SAFE_APP_COMMANDS = new Map([
  ['copyDeeplink', { label: '复制 Codex 链接', key: 'l', modifiers: ['command', 'option'] }],
  ['copyConversationPath', { label: '复制会话路径', key: 'c', modifiers: ['command', 'option', 'shift'] }],
  ['copySessionId', { label: '复制 Session ID', key: 'c', modifiers: ['command', 'option'] }],
  ['copyWorkingDirectory', { label: '复制工作目录', key: 'c', modifiers: ['command', 'shift'] }],
  ['openCommandMenu', { label: '打开命令面板', key: 'k', modifiers: ['command'] }],
  ['searchChats', { label: '搜索对话', key: 'g', modifiers: ['command'] }],
  ['searchFiles', { label: '搜索文件', key: 'p', modifiers: ['command'] }],
  ['findInThread', { label: '在当前对话查找', key: 'f', modifiers: ['command'] }],
  ['showKeyboardShortcuts', { label: '显示快捷键', key: '/', modifiers: ['command', 'shift'] }],
  ['settings', { label: '打开设置', key: ',', modifiers: ['command'] }],
  ['openFolder', { label: '打开文件夹', key: 'o', modifiers: ['command'] }],
  ['newWindow', { label: '新窗口', key: 'n', modifiers: ['command', 'shift'] }],
  ['toggleSidebar', { label: '切换侧边栏', key: 'b', modifiers: ['command'] }],
  ['toggleBottomPanel', { label: '切换底部面板', key: 'j', modifiers: ['command'] }],
  ['toggleTerminal', { label: '切换终端', key: '`', modifiers: ['control'] }],
  ['toggleSidePanel', { label: '切换右侧面板', key: 'b', modifiers: ['command', 'option'] }],
  ['toggleBrowserPanel', { label: '切换浏览器面板', key: 'b', modifiers: ['command', 'shift'] }],
  ['openBrowserTab', { label: '打开浏览器标签', key: 't', modifiers: ['command'] }],
  ['openReviewTab', { label: '打开审查标签', key: 'g', modifiers: ['control', 'shift'] }],
  ['openSideChat', { label: '打开边聊', key: 's', modifiers: ['command', 'option'] }],
  ['composer.openModelPicker', { label: '打开模型选择器', key: 'm', modifiers: ['control', 'shift'] }],
]);
const CODEX_SAFE_APP_COMMAND_ALIASES = new Map([
  ['copy-deeplink', 'copyDeeplink'],
  ['copy-link', 'copyDeeplink'],
  ['copy-conversation-path', 'copyConversationPath'],
  ['copy-session-id', 'copySessionId'],
  ['copy-working-directory', 'copyWorkingDirectory'],
  ['command-menu', 'openCommandMenu'],
  ['open-command-menu', 'openCommandMenu'],
  ['search-chats', 'searchChats'],
  ['search-files', 'searchFiles'],
  ['find', 'findInThread'],
  ['find-in-thread', 'findInThread'],
  ['keyboard-shortcuts', 'showKeyboardShortcuts'],
  ['open-settings', 'settings'],
  ['open-folder', 'openFolder'],
  ['new-window', 'newWindow'],
  ['sidebar', 'toggleSidebar'],
  ['toggle-sidebar', 'toggleSidebar'],
  ['bottom-panel', 'toggleBottomPanel'],
  ['toggle-bottom-panel', 'toggleBottomPanel'],
  ['terminal', 'toggleTerminal'],
  ['toggle-terminal', 'toggleTerminal'],
  ['side-panel', 'toggleSidePanel'],
  ['toggle-side-panel', 'toggleSidePanel'],
  ['browser-panel', 'toggleBrowserPanel'],
  ['toggle-browser-panel', 'toggleBrowserPanel'],
  ['browser-tab', 'openBrowserTab'],
  ['open-browser-tab', 'openBrowserTab'],
  ['review-tab', 'openReviewTab'],
  ['open-review-tab', 'openReviewTab'],
  ['side-chat', 'openSideChat'],
  ['open-side-chat', 'openSideChat'],
  ['model-picker', 'composer.openModelPicker'],
  ['open-model-picker', 'composer.openModelPicker'],
]);
const RELAY_HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const recentSendRequests = new Map();
let lastCodexThreadActivation = { threadId: '', at: 0 };
let codexSessionFilesCache = { at: 0, files: [] };
let threadIndexCache = { mtimeMs: 0, size: 0, byId: null };
const sessionMetaCache = new Map();
const firstUserMessageCache = new Map();
const runtimeSummaryCache = new Map();
const codexThreadListCache = new Map();
const jsonlTailLinesCache = new Map();
const jsonlTailObjectsCache = new Map();
const codexThreadHistoryCache = new Map();
let modelCatalogCache = { mtimeMs: -1, path: '', models: null };
let keepAwakeProcess = null;
let keepAwakeStartedAt = '';

function defaultRelayDeviceId() {
  let username = '';
  try {
    username = os.userInfo().username || '';
  } catch {
    username = '';
  }
  return String(username || os.hostname() || 'windows-pc')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58) || 'windows-pc';
}

function fileCacheSignature(stat) {
  return stat ? `${stat.size}:${stat.mtimeMs}` : '';
}

function boundedSet(map, key, value, limit = 300) {
  if (map.size >= limit && !map.has(key)) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
  return value;
}

function invalidateCodexThreadListCache() {
  codexThreadListCache.clear();
}

function isKeepAwakeActive() {
  return Boolean(keepAwakeProcess && keepAwakeProcess.exitCode === null && !keepAwakeProcess.killed);
}

function keepAwakeStatus() {
  return {
    enabled: isKeepAwakeActive(),
    startedAt: isKeepAwakeActive() ? keepAwakeStartedAt : '',
    command: 'caffeinate -dims',
  };
}

function startKeepAwake() {
  if (isKeepAwakeActive()) return keepAwakeStatus();
  const caffeinatePath = '/usr/bin/caffeinate';
  if (!fs.existsSync(caffeinatePath)) {
    const error = new Error('这台 Mac 没有找到 caffeinate，无法阻止休眠。');
    error.code = 'CAFFEINATE_NOT_FOUND';
    throw error;
  }
  const child = spawn(caffeinatePath, ['-dims'], { stdio: 'ignore' });
  keepAwakeProcess = child;
  keepAwakeStartedAt = new Date().toISOString();
  child.on('exit', () => {
    if (keepAwakeProcess === child) {
      keepAwakeProcess = null;
      keepAwakeStartedAt = '';
    }
  });
  child.on('error', () => {
    if (keepAwakeProcess === child) {
      keepAwakeProcess = null;
      keepAwakeStartedAt = '';
    }
  });
  return keepAwakeStatus();
}

function stopKeepAwake() {
  const child = keepAwakeProcess;
  keepAwakeProcess = null;
  keepAwakeStartedAt = '';
  if (child && child.exitCode === null && !child.killed) {
    try { child.kill('SIGTERM'); } catch {}
  }
  return keepAwakeStatus();
}

function cleanupKeepAwake() {
  stopKeepAwake();
}

function readCodexConfigText() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
  } catch {
    return '';
  }
}

function tomlStringValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]*)"\\s*$`, 'm'));
  return match ? match[1] : '';
}

function labelFromModelName(name = '') {
  const text = String(name || '').trim();
  if (!text) return '';
  return text
    .replace(/[（(].*?[）)]/g, '')
    .replace(/^GPT-/i, '')
    .replace(/^gpt-/i, '')
    .replace(/^codex-/i, '')
    .trim() || text;
}

function normalizeModelOption(row = {}) {
  const id = String(row.slug || row.id || row.model || '').trim();
  if (!id) return null;
  const displayName = String(row.displayName || row.display_name || row.name || row.label || id).trim();
  return {
    key: String(row.key || id).trim() || id,
    id,
    label: String(row.label || labelFromModelName(displayName || id)).trim(),
    displayName: displayName || id,
    source: row.source || 'local',
  };
}

function mergeModelOptions(rows = []) {
  const merged = [];
  const seen = new Set();
  for (const option of [...DEFAULT_MODEL_OPTIONS, ...rows].map(normalizeModelOption).filter(Boolean)) {
    const dedupeKey = `${option.id.toLowerCase()}|${option.key.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push(option);
  }
  return merged;
}

function readModelCatalogOptions() {
  const configText = readCodexConfigText();
  const catalogPath = tomlStringValue(configText, 'model_catalog_json');
  const resolvedPath = catalogPath.startsWith('~') ? path.join(os.homedir(), catalogPath.slice(1)) : catalogPath;
  const fallback = () => {
    const current = tomlStringValue(configText, 'model');
    const currentOption = current ? [{ key: current, id: current, label: labelFromModelName(current), displayName: current, source: 'local' }] : [];
    return mergeModelOptions(currentOption);
  };
  if (!resolvedPath) return fallback();
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    return fallback();
  }
  if (modelCatalogCache.models && modelCatalogCache.path === resolvedPath && modelCatalogCache.mtimeMs === stat.mtimeMs) {
    return modelCatalogCache.models;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const models = (Array.isArray(parsed.models) ? parsed.models : [])
      .filter(row => row && row.visibility !== 'hide')
      .map(normalizeModelOption)
      .filter(Boolean);
    const merged = mergeModelOptions(models);
    modelCatalogCache = { path: resolvedPath, mtimeMs: stat.mtimeMs, models: merged };
    return merged;
  } catch {
    return fallback();
  }
}

function findModelOption(id = '') {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  const normalizedTarget = targetId.toLowerCase();
  return readModelCatalogOptions().find(item => item.id.toLowerCase() === normalizedTarget || item.key.toLowerCase() === normalizedTarget) || null;
}

function emptyCodexState() {
  return {
    pinnedThreadIds: [],
    archivedThreadIds: [],
    titleOverrides: {},
    guiFailureReports: {},
    controlConfig: {},
  };
}

function normalizeControlConfig(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const port = Number(input.port);
  const relayUrl = String(input.relayUrl || '');
  return {
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : '',
    relayUrl: relayUrl.slice(0, 240),
    deviceId: defaultRelayDeviceId(),
    remoteKeyMode: 'manual',
    remoteKey: normalizeRemoteAccessKey(input.remoteKey || ''),
  };
}

function publicControlConfig(config = {}, options = {}) {
  const normalized = normalizeControlConfig(config);
  const exposeSecrets = Boolean(options.exposeSecrets);
  return {
    port: normalized.port,
    relayUrl: normalized.relayUrl,
    deviceId: normalized.deviceId,
    remoteKeyMode: normalized.remoteKeyMode,
    remoteKey: exposeSecrets ? normalized.remoteKey : '',
    remoteKeyConfigured: Boolean(normalized.remoteKey),
    remoteKeyMasked: redactSecret(normalized.remoteKey),
  };
}

function readCodexState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      pinnedThreadIds: Array.isArray(parsed.pinnedThreadIds) ? parsed.pinnedThreadIds.filter(isCodexThreadId) : [],
      archivedThreadIds: Array.isArray(parsed.archivedThreadIds) ? parsed.archivedThreadIds.filter(isCodexThreadId) : [],
      titleOverrides: parsed.titleOverrides && typeof parsed.titleOverrides === 'object' ? parsed.titleOverrides : {},
      guiFailureReports: normalizeGuiFailureReports(parsed.guiFailureReports),
      controlConfig: normalizeControlConfig(parsed.controlConfig),
    };
  } catch {
    return emptyCodexState();
  }
}

function writeCodexState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const normalized = {
    pinnedThreadIds: [...new Set((state.pinnedThreadIds || []).filter(isCodexThreadId))],
    archivedThreadIds: [...new Set((state.archivedThreadIds || []).filter(isCodexThreadId))],
    titleOverrides: state.titleOverrides && typeof state.titleOverrides === 'object' ? state.titleOverrides : {},
    guiFailureReports: normalizeGuiFailureReports(state.guiFailureReports),
    controlConfig: normalizeControlConfig(state.controlConfig),
  };
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  invalidateCodexThreadListCache();
  return normalized;
}

function normalizeGuiFailureReports(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [threadId, rows] of Object.entries(value)) {
    if (!isCodexThreadId(threadId) || !Array.isArray(rows)) continue;
    const normalizedRows = rows
      .map(row => ({
        turnId: typeof row.turnId === 'string' ? row.turnId : '',
        text: truncateText(normalizeHistoryText(row.text || ''), 2000),
        capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : '',
        completedAt: typeof row.completedAt === 'string' ? row.completedAt : '',
        source: typeof row.source === 'string' ? row.source : 'unknown',
      }))
      .filter(row => row.text)
      .slice(-GUI_FAILURE_REPORT_LIMIT);
    if (normalizedRows.length) out[threadId] = normalizedRows;
  }
  return out;
}

function setThreadSetMembership(list, threadId, enabled) {
  const set = new Set((Array.isArray(list) ? list : []).filter(isCodexThreadId));
  if (enabled) set.add(threadId);
  else set.delete(threadId);
  return [...set];
}

function truncateText(value, max = 700) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => item && (item.text || item.message || '')).filter(Boolean).join('\n');
}

function normalizeHistoryText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function extractPlainTextDeep(value, seen = new Set()) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const out = [];
  if (Array.isArray(value)) {
    for (const item of value) out.push(...extractPlainTextDeep(item, seen));
    return out;
  }

  for (const key of ['message', 'detail', 'details', 'error', 'reason', 'description', 'status', 'code', 'title', 'text']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) out.push(...extractPlainTextDeep(value[key], seen));
  }
  return out;
}

function isFailureLikePayload(payload = {}) {
  const type = String(payload.type || '').toLowerCase();
  const status = String(payload.status || '').toLowerCase();
  const code = String(payload.code || '').toLowerCase();
  return (
    /(?:error|fail|failed|failure|timeout|rate_limit|unavailable|overload|abort|cancel|interrupt)/.test(type) ||
    /(?:error|fail|failed|failure|timeout|rate_limit|unavailable|overload|abort|cancel|interrupt)/.test(status) ||
    /(?:error|fail|failed|failure|timeout|rate_limit|unavailable|overload|abort|cancel|interrupt)/.test(code) ||
    payload.error != null ||
    payload.detail != null ||
    payload.details != null ||
    payload.reason != null
  );
}

function isTerminalFailurePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return false;
  const type = String(payload.type || '').toLowerCase();
  return (
    type === 'turn_aborted' ||
    /(?:^|_)(?:failed|failure|error|timeout|cancelled|canceled|aborted|interrupted)$/.test(type) ||
    (
      isFailureLikePayload(payload) &&
      /(?:abort|cancel|interrupt|fail|error|timeout|unavailable|overload)/.test(type)
    )
  );
}

function extractFailureTextFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || !isFailureLikePayload(payload)) return '';
  const text = extractPlainTextDeep(payload)
    .map(value => normalizeHistoryText(value))
    .filter(Boolean)
    .filter(value => !/^(true|false|null|undefined)$/i.test(value))
    .join('\n');
  return truncateText(text, 1600);
}

function emptyCodexFailureText() {
  return 'Codex GUI 这次没有返回可显示回复。会话日志也没有写入可读取的失败提示原文；请在电脑 Codex GUI 查看原始失败提示。';
}

function decodeLogQuotedValue(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function safeParseJsonText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonAssignment(line, key) {
  const marker = `${key}=`;
  const start = line.indexOf(marker);
  if (start < 0) return null;
  const open = line.indexOf('{', start + marker.length);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < line.length; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return line.slice(open, i + 1);
    }
  }
  return null;
}

function extractDesktopLogFailureText(line) {
  const raw = String(line || '');
  if (!/(?:\berror\b|failed|failure|Forbidden|unexpected status|channel affinity|AiMaMi|revoked|Unauthorized)/i.test(raw)) return '';
  if (/(?:git\.command\.complete|worker_rpc_response_error|Conversation state not found|Received turn\/(?:started|completed) for unknown conversation|Item not found in turn state)/i.test(raw)) return '';
  const candidates = [];
  for (const key of ['error', 'result']) {
    const jsonText = extractJsonAssignment(raw, key);
    const parsed = jsonText ? safeParseJsonText(jsonText) : null;
    const directText = parsed && typeof parsed === 'object'
      ? normalizeHistoryText(parsed.message || parsed.detail || parsed.error || parsed.reason || '')
      : '';
    const text = parsed ? (directText || extractFailureTextFromPayload(parsed) || truncateText(extractPlainTextDeep(parsed).map(value => normalizeHistoryText(value)).filter(Boolean).join('\n'), 2000)) : '';
    if (text) candidates.push(text);
  }
  for (const key of ['errorMessage', 'message', 'detail']) {
    const match = raw.match(new RegExp(`(?:^|\\s)${key}="((?:\\\\.|[^"])*)"`, 'i'));
    if (match) candidates.push(decodeLogQuotedValue(match[1]));
  }
  if (!candidates.length && /(?:unexpected status|Forbidden|channel affinity|AiMaMi)/i.test(raw)) {
    candidates.push(raw.replace(/^\S+\s+\w+\s+\[[^\]]+\]\s*/, '').trim());
  }
  const text = uniqueList(candidates
    .map(value => normalizeHistoryText(value))
    .filter(Boolean)
    .filter(value => !/^Request failed$/i.test(value)))
    .join('\n');
  return truncateText(text, 2000);
}

function scoreDesktopFailureLine(line, text, options = {}) {
  const raw = String(line || '');
  const failure = String(text || '');
  if (!failure) return 0;
  let score = 1;
  const threadId = isCodexThreadId(options.threadId) ? options.threadId : '';
  const turnId = typeof options.turnId === 'string' ? options.turnId : '';
  if (threadId && raw.includes(threadId)) score += 80;
  if (turnId && raw.includes(turnId)) score += 80;
  if (/Structured turn failed/i.test(failure)) score += 55;
  if (/unexpected status|Forbidden|channel affinity|AiMaMi/i.test(failure)) score += 45;
  if (/refresh token was revoked|log out and sign in again|access token could not be refreshed/i.test(failure)) score += 45;
  if (/Failed to generate thread title/i.test(raw) && /Structured turn failed/i.test(failure)) score += 25;
  if (/Conversation state not found|unknown conversation|Failed to write temporary index tree snapshot|remote\.upstream\.url/i.test(failure)) score -= 80;
  return score;
}

function recentCodexDesktopLogFiles(referenceMs = Date.now()) {
  return walkFiles(CODEX_DESKTOP_LOGS_DIR, file => file.endsWith('.log'))
    .map(file => {
      try {
        const stat = fs.statSync(file);
        return { file, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => item.mtimeMs >= referenceMs - GUI_FAILURE_LOG_RECENT_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 40)
    .map(item => item.file);
}

function findCodexDesktopFailureText(options = {}) {
  const threadId = isCodexThreadId(options.threadId) ? options.threadId : '';
  const turnId = typeof options.turnId === 'string' ? options.turnId : '';
  const startedMs = Date.parse(options.startedAt || '') || 0;
  const completedMs = Date.parse(options.completedAt || '') || Date.now();
  const minMs = startedMs ? startedMs - 60 * 1000 : completedMs - GUI_FAILURE_LOG_RECENT_MS;
  const maxMs = completedMs + 2 * 60 * 1000;
  const matches = [];
  for (const file of recentCodexDesktopLogFiles(completedMs)) {
    let lines;
    try {
      lines = readTailLinesWithLimit(file, GUI_FAILURE_LOG_SCAN_BYTES);
    } catch {
      continue;
    }
    for (const line of lines) {
      const lineMs = Date.parse(line.slice(0, 24));
      if (Number.isFinite(lineMs) && (lineMs < minMs || lineMs > maxMs)) continue;
      const text = extractDesktopLogFailureText(line);
      const score = scoreDesktopFailureLine(line, text, options);
      if (score >= 50) matches.push({ text, lineMs: Number.isFinite(lineMs) ? lineMs : 0, score });
    }
  }
  matches.sort((a, b) => b.score - a.score || b.lineMs - a.lineMs);
  return matches[0] ? matches[0].text : '';
}

function findStoredGuiFailureText(threadId, options = {}) {
  if (!isCodexThreadId(threadId)) return '';
  const rows = readCodexState().guiFailureReports[threadId] || [];
  const turnId = typeof options.turnId === 'string' ? options.turnId : '';
  if (turnId) {
    const exact = [...rows].reverse().find(row => row.turnId === turnId && row.text);
    if (exact) return exact.text;
  }
  const completedMs = Date.parse(options.completedAt || '') || 0;
  if (completedMs) {
    const close = [...rows].reverse().find(row => {
      const rowMs = Date.parse(row.completedAt || row.capturedAt || '') || 0;
      return row.text && rowMs && Math.abs(rowMs - completedMs) <= GUI_FAILURE_LOG_RECENT_MS;
    });
    if (close) return close.text;
  }
  const latest = rows[rows.length - 1];
  return latest && latest.text ? latest.text : '';
}

function storeGuiFailureText(threadId, report = {}) {
  if (!isCodexThreadId(threadId)) return '';
  const text = truncateText(normalizeHistoryText(report.text || ''), 2000);
  if (!text || text === emptyCodexFailureText()) return '';
  const state = readCodexState();
  const rows = state.guiFailureReports[threadId] || [];
  const turnId = typeof report.turnId === 'string' ? report.turnId : '';
  const completedAt = typeof report.completedAt === 'string' ? report.completedAt : '';
  const existingIndex = rows.findIndex(row => (turnId && row.turnId === turnId) || (completedAt && row.completedAt === completedAt && row.text === text));
  const row = {
    turnId,
    text,
    capturedAt: new Date().toISOString(),
    completedAt,
    source: typeof report.source === 'string' ? report.source : 'codex_desktop',
  };
  if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...row };
  else rows.push(row);
  state.guiFailureReports[threadId] = rows.slice(-GUI_FAILURE_REPORT_LIMIT);
  writeCodexState(state);
  return text;
}

function resolveFailureTextForTurn(threadId, options = {}) {
  const sessionText = normalizeHistoryText(options.failureText || '');
  if (sessionText) {
    storeGuiFailureText(threadId, { ...options, text: sessionText, source: 'codex_session' });
    return sessionText;
  }
  const storedText = findStoredGuiFailureText(threadId, options);
  if (storedText) return storedText;
  const desktopText = findCodexDesktopFailureText({ ...options, threadId });
  if (desktopText) return storeGuiFailureText(threadId, { ...options, text: desktopText, source: 'codex_desktop_log' }) || desktopText;
  return '';
}

function cleanUserHistoryText(value) {
  const text = normalizeHistoryText(value);
  const marker = '## My request for Codex:';
  const index = text.indexOf(marker);
  if (index >= 0) return normalizeHistoryText(text.slice(index + marker.length));
  return text;
}

function isPlaceholderThreadName(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return [
    '未命名线程',
    '未命名',
    'untitled',
    'untitled thread',
    'new thread',
  ].includes(text);
}

function summarizeThreadTitle(value, maxLength = 34) {
  let text = cleanUserHistoryText(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, '[key]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[token]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/[#>*_[\]()~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function walkFiles(dir, predicate, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function listCodexSessionFiles(options = {}) {
  const now = Date.now();
  if (!options.force && codexSessionFilesCache.files.length && now - codexSessionFilesCache.at <= CODEX_SESSION_FILE_CACHE_MS) {
    return codexSessionFilesCache.files;
  }
  const files = walkFiles(CODEX_SESSIONS_DIR, file => file.endsWith('.jsonl'));
  codexSessionFilesCache = { at: now, files };
  return files;
}

function threadIdFromSessionFile(file) {
  return (path.basename(file || '').match(/([a-f0-9]{8}-[a-f0-9-]{27,})\.jsonl$/i) || [])[1] || '';
}

function normalizeComparableMessage(value) {
  return cleanUserHistoryText(value).replace(/\s+/g, ' ').trim();
}

function findLatestCodexSessionFile(options = {}) {
  const excludeThreadId = isCodexThreadId(options.excludeThreadId) ? options.excludeThreadId : '';
  const afterMs = Number(options.afterMs) || 0;
  const expectedCwd = validLocalDirectory(options.cwd || '');
  const files = listCodexSessionFiles(afterMs ? { force: true } : {});
  let best = null;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      const threadId = threadIdFromSessionFile(file);
      if (excludeThreadId && threadId === excludeThreadId) continue;
      if (afterMs && stat.mtimeMs < afterMs - 2500) continue;
      if (expectedCwd) {
        const metaCwd = validLocalDirectory(readSessionMeta(file).cwd || '');
        if (metaCwd !== expectedCwd) continue;
      }
      if (!best || stat.mtimeMs > best.mtimeMs) best = { file, mtimeMs: stat.mtimeMs };
    } catch {
      // ignore disappearing files
    }
  }
  return best && best.file;
}

function findCodexSessionFileByName(name) {
  if (!name || name.includes('/') || name.includes('..')) return null;
  const files = listCodexSessionFiles();
  return files.find(file => path.basename(file) === name) || null;
}

function findCodexSessionFileByThreadId(threadId) {
  if (!isCodexThreadId(threadId)) return null;
  const files = listCodexSessionFiles();
  let best = null;
  for (const file of files) {
    if (!path.basename(file).includes(threadId)) continue;
    try {
      const stat = fs.statSync(file);
      if (!best || stat.mtimeMs > best.mtimeMs) best = { file, mtimeMs: stat.mtimeMs };
    } catch {}
  }
  return best && best.file;
}

function isCodexThreadId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(value);
}

function codexThreadDeepLink(threadId) {
  if (!isCodexThreadId(threadId)) return null;
  // Codex desktop's own “Copy app link” action uses codex://threads/<id>.
  // The previous codex://local/<id> only brought the app forward on this build,
  // but did not navigate the visible UI, so paste could still hit the wrong thread.
  return `codex://threads/${threadId}`;
}

function codexNewThreadDeepLink(cwd = '') {
  const url = new URL('codex://threads/new');
  if (cwd) url.searchParams.set('path', cwd);
  return url.toString();
}

function setCodexQueryParam(url, key, value, options = {}) {
  const text = String(value || '').trim();
  if (!text) {
    if (options.required) throw Object.assign(new Error(`${key} 不能为空。`), { status: 400, code: 'MISSING_CODEX_LINK_PARAM' });
    return;
  }
  if (options.maxLength && text.length > options.maxLength) {
    throw Object.assign(new Error(`${key} 太长。`), { status: 400, code: 'CODEX_LINK_PARAM_TOO_LONG' });
  }
  url.searchParams.set(key, text);
}

function setCodexLocalPathParam(url, key, value, options = {}) {
  const text = String(value || '').trim();
  if (!text) {
    if (options.required) throw Object.assign(new Error(`${key} 不能为空。`), { status: 400, code: 'MISSING_CODEX_LINK_PARAM' });
    return;
  }
  if (!path.isAbsolute(text)) {
    throw Object.assign(new Error(`${key} 必须是绝对路径。`), { status: 400, code: 'BAD_CODEX_LINK_PATH' });
  }
  if (options.mustExist && !validLocalDirectory(text)) {
    throw Object.assign(new Error(`${key} 必须指向本机已有目录。`), { status: 400, code: 'BAD_CODEX_LINK_PATH' });
  }
  url.searchParams.set(key, path.normalize(text));
}

function setCodexHttpsParam(url, key, value, options = {}) {
  const text = String(value || '').trim();
  if (!text) {
    if (options.required) throw Object.assign(new Error(`${key} 不能为空。`), { status: 400, code: 'MISSING_CODEX_LINK_PARAM' });
    return;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw Object.assign(new Error(`${key} 必须是 HTTPS URL。`), { status: 400, code: 'BAD_CODEX_LINK_URL' });
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error(`${key} 必须是 HTTPS URL。`), { status: 400, code: 'BAD_CODEX_LINK_URL' });
  }
  url.searchParams.set(key, parsed.toString());
}

function assertNoUnknownQuery(url, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw Object.assign(new Error(`不支持的 Codex 链接参数：${key}`), { status: 400, code: 'BAD_CODEX_LINK_PARAM' });
    }
  }
}

function codexDeepLinkForNewThread(payload = {}, useShortForm = false) {
  const url = new URL(useShortForm ? 'codex://new' : 'codex://threads/new');
  setCodexQueryParam(url, 'prompt', payload.prompt, { maxLength: MAX_TEXT_LENGTH });
  setCodexLocalPathParam(url, 'path', payload.path, { mustExist: true });
  setCodexQueryParam(url, 'originUrl', payload.originUrl, { maxLength: 2000 });
  if (useShortForm && !url.search) {
    throw Object.assign(new Error('codex://new 需要 prompt、path 或 originUrl 参数。'), { status: 400, code: 'EMPTY_CODEX_NEW_LINK' });
  }
  return url.toString();
}

function codexDeepLinkForSettings(page = '', payload = {}) {
  const normalized = String(page || '').trim().replace(/^\/+|\/+$/g, '');
  const allowed = new Set([
    '',
    'browser-use',
    'computer-use/google-chrome',
    'connections',
    'connections/computer',
    'connections/devices',
    'connections/ssh',
    'connections/ssh/add',
  ]);
  if (!allowed.has(normalized)) {
    throw Object.assign(new Error('不支持的 Codex 设置入口。'), { status: 400, code: 'BAD_CODEX_SETTINGS_LINK' });
  }
  const url = new URL(normalized ? `codex://settings/${normalized}` : 'codex://settings');
  if (normalized === 'connections/ssh/add') {
    setCodexQueryParam(url, 'name', payload.name, { required: true, maxLength: 120 });
  }
  return url.toString();
}

function codexDeepLinkForPlugin(payload = {}) {
  const pluginId = String(payload.pluginId || payload.id || '').trim();
  if (!/^[a-zA-Z0-9._@-]{1,180}$/.test(pluginId)) {
    throw Object.assign(new Error('插件 ID 不正确。'), { status: 400, code: 'BAD_CODEX_PLUGIN_ID' });
  }
  const url = new URL(`codex://plugins/${pluginId}`);
  setCodexQueryParam(url, 'hostId', payload.hostId, { maxLength: 120 });
  if (payload.source) {
    if (String(payload.source).trim() !== 'manage') {
      throw Object.assign(new Error('插件 source 只支持 manage。'), { status: 400, code: 'BAD_CODEX_PLUGIN_SOURCE' });
    }
    url.searchParams.set('source', 'manage');
  }
  return url.toString();
}

function codexDeepLinkForLocalPlugin(payload = {}) {
  const url = new URL('codex://plugins/');
  setCodexLocalPathParam(url, 'marketplacePath', payload.marketplacePath, { required: true });
  if (payload.mode) {
    if (String(payload.mode).trim() !== 'share') {
      throw Object.assign(new Error('本地插件 mode 只支持 share。'), { status: 400, code: 'BAD_CODEX_PLUGIN_MODE' });
    }
    url.searchParams.set('mode', 'share');
  }
  return url.toString();
}

function codexDeepLinkForPayload(payload = {}) {
  const kind = String(payload.kind || payload.type || '').trim().toLowerCase();
  if (payload.url) return normalizeCodexDeepLinkUrl(payload.url);
  if (kind === 'thread') return codexThreadDeepLink(String(payload.threadId || ''));
  if (kind === 'threads-new' || kind === 'thread-new' || kind === 'new-thread') return codexDeepLinkForNewThread(payload);
  if (kind === 'new') return codexDeepLinkForNewThread(payload, true);
  if (kind === 'settings') return codexDeepLinkForSettings(payload.page, payload);
  if (kind === 'skills') return 'codex://skills';
  if (kind === 'automations') return 'codex://automations';
  if (kind === 'plugin-install') {
    const url = new URL('codex://plugins/install/');
    setCodexQueryParam(url, 'marketplace', payload.marketplace, { required: true, maxLength: 120 });
    return url.toString();
  }
  if (kind === 'plugin') return codexDeepLinkForPlugin(payload);
  if (kind === 'local-plugin') return codexDeepLinkForLocalPlugin(payload);
  if (kind === 'pet' || kind === 'pet-install') {
    const url = new URL('codex://pets/install');
    setCodexQueryParam(url, 'name', payload.name, { required: true, maxLength: 80 });
    setCodexHttpsParam(url, 'imageUrl', payload.imageUrl, { required: true });
    setCodexQueryParam(url, 'description', payload.description, { maxLength: 500 });
    return url.toString();
  }
  throw Object.assign(new Error('不支持的 Codex 调用类型。'), { status: 400, code: 'BAD_CODEX_LINK_KIND' });
}

function normalizeCodexDeepLinkUrl(value) {
  let input;
  try {
    input = new URL(String(value || '').trim());
  } catch {
    throw Object.assign(new Error('Codex 链接格式不正确。'), { status: 400, code: 'BAD_CODEX_LINK' });
  }
  if (input.protocol !== 'codex:') {
    throw Object.assign(new Error('只支持 codex:// 链接。'), { status: 400, code: 'BAD_CODEX_LINK_PROTOCOL' });
  }
  const host = input.hostname;
  const cleanPath = decodeURIComponent(input.pathname || '').replace(/^\/+|\/+$/g, '');
  const query = Object.fromEntries(input.searchParams.entries());

  if (host === 'threads') {
    if (cleanPath === 'new') {
      assertNoUnknownQuery(input, ['prompt', 'path', 'originUrl']);
      return codexDeepLinkForNewThread(query);
    }
    if (isCodexThreadId(cleanPath)) return codexThreadDeepLink(cleanPath);
  }
  if (host === 'new') {
    assertNoUnknownQuery(input, ['prompt', 'path', 'originUrl']);
    return codexDeepLinkForNewThread(query, true);
  }
  if (host === 'settings') {
    assertNoUnknownQuery(input, cleanPath === 'connections/ssh/add' ? ['name'] : []);
    return codexDeepLinkForSettings(cleanPath, query);
  }
  if (host === 'skills' && !cleanPath) return 'codex://skills';
  if (host === 'automations' && !cleanPath) return 'codex://automations';
  if (host === 'plugins') {
    if (cleanPath === 'install') {
      assertNoUnknownQuery(input, ['marketplace']);
      const url = new URL('codex://plugins/install/');
      setCodexQueryParam(url, 'marketplace', input.searchParams.get('marketplace'), { required: true, maxLength: 120 });
      return url.toString();
    }
    if (!cleanPath) {
      assertNoUnknownQuery(input, ['marketplacePath', 'mode']);
      return codexDeepLinkForLocalPlugin(query);
    }
    assertNoUnknownQuery(input, ['hostId', 'source']);
    return codexDeepLinkForPlugin({ pluginId: cleanPath, ...query });
  }
  if (host === 'pets' && cleanPath === 'install') {
    assertNoUnknownQuery(input, ['name', 'imageUrl', 'description']);
    return codexDeepLinkForPayload({ kind: 'pet-install', ...query });
  }
  throw Object.assign(new Error('这个 codex:// 链接不在当前白名单内。'), { status: 400, code: 'UNSUPPORTED_CODEX_LINK' });
}

function readThreadIndex() {
  let stat = null;
  try { stat = fs.statSync(CODEX_SESSION_INDEX); } catch {}
  if (
    stat &&
    threadIndexCache.byId &&
    threadIndexCache.mtimeMs === stat.mtimeMs &&
    threadIndexCache.size === stat.size
  ) {
    return new Map(threadIndexCache.byId);
  }
  const byId = new Map();
  try {
    const lines = fs.readFileSync(CODEX_SESSION_INDEX, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (!item.id) continue;
        byId.set(item.id, {
          id: item.id,
          name: item.thread_name || '',
          updatedAt: item.updated_at || '',
        });
      } catch {}
    }
  } catch {}
  if (stat) threadIndexCache = { mtimeMs: stat.mtimeMs, size: stat.size, byId: new Map(byId) };
  return byId;
}

function findFirstCodexUserMessage(file, maxBytes = CODEX_TITLE_SCAN_BYTES) {
  let stat;
  try { stat = fs.statSync(file); } catch { return ''; }
  const cacheKey = `${file}:${fileCacheSignature(stat)}:${maxBytes}`;
  if (firstUserMessageCache.has(cacheKey)) return firstUserMessageCache.get(cacheKey);
  const limit = Math.min(stat.size, maxBytes);
  const chunkSize = 64 * 1024;
  const maxLineBytes = 2 * 1024 * 1024;
  let fd;
  let carry = '';
  let skippingLongLine = false;

  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(chunkSize);
    let offset = 0;
    while (offset < limit) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(chunkSize, limit - offset), offset);
      if (!bytes) break;
      offset += bytes;
      let text = buffer.toString('utf8', 0, bytes);

      if (skippingLongLine) {
        const newline = text.indexOf('\n');
        if (newline < 0) continue;
        text = text.slice(newline + 1);
        skippingLongLine = false;
      }

      carry += text;
      if (carry.length > maxLineBytes) {
        const newline = carry.indexOf('\n');
        if (newline < 0) {
          carry = '';
          skippingLongLine = true;
          continue;
        }
      }

      let newlineIndex;
      while ((newlineIndex = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, newlineIndex);
        carry = carry.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        const payload = item.payload || {};
        if (item.type === 'event_msg' && payload.type === 'user_message') {
          const title = summarizeThreadTitle(payload.message || '');
          if (title) return boundedSet(firstUserMessageCache, cacheKey, title);
        }
      }
    }

    if (carry.trim() && carry.length <= maxLineBytes) {
      try {
        const item = JSON.parse(carry);
        const payload = item.payload || {};
        if (item.type === 'event_msg' && payload.type === 'user_message') {
          return boundedSet(firstUserMessageCache, cacheKey, summarizeThreadTitle(payload.message || ''));
        }
      } catch {}
    }
  } catch {
    return '';
  } finally {
    if (typeof fd === 'number') {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return boundedSet(firstUserMessageCache, cacheKey, '');
}

function readSessionMeta(file) {
  let stat = null;
  try { stat = fs.statSync(file); } catch {}
  const cacheKey = stat ? `${file}:${fileCacheSignature(stat)}` : '';
  if (cacheKey && sessionMetaCache.has(cacheKey)) return sessionMetaCache.get(cacheKey);
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const lines = buffer.toString('utf8', 0, bytes).split('\n').filter(Boolean).slice(0, 80);
      for (const line of lines) {
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        if (item.type === 'session_meta' && item.payload) return cacheKey ? boundedSet(sessionMetaCache, cacheKey, item.payload) : item.payload;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
  return cacheKey ? boundedSet(sessionMetaCache, cacheKey, {}) : {};
}

function userMessageMatchScore(file, sinceMs = 0, text = '') {
  const expected = normalizeComparableMessage(text);
  const items = readJsonlTailObjects(file, CODEX_TITLE_SCAN_BYTES);
  let score = 0;
  for (const item of items) {
    const payload = item.payload || {};
    if (item.type !== 'event_msg' || payload.type !== 'user_message') continue;
    const t = Date.parse(item.timestamp || '');
    if (sinceMs && Number.isFinite(t) && t < sinceMs - 2500) continue;
    const actual = normalizeComparableMessage(payload.message || '');
    if (!actual && expected) continue;
    score = Math.max(score, 10);
    if (Number.isFinite(t)) score += Math.max(0, Math.min(25, Math.round((t - sinceMs) / 1000) + 20));
    if (expected && actual) {
      if (actual === expected) score += 100;
      else if (actual.includes(expected) || expected.includes(actual)) score += 70;
    }
  }
  return score;
}

function findCodexSessionFileForNewSend(options = {}) {
  const sinceMs = Number(options.sinceMs) || 0;
  const text = typeof options.text === 'string' ? options.text : '';
  const expectedCwd = validLocalDirectory(options.cwd || '');
  const excludeThreadId = isCodexThreadId(options.excludeThreadId) ? options.excludeThreadId : '';
  const files = listCodexSessionFiles({ force: true });
  let best = null;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      const threadId = threadIdFromSessionFile(file);
      if (excludeThreadId && threadId === excludeThreadId) continue;
      if (sinceMs && stat.mtimeMs < sinceMs - 2500) continue;
      let score = userMessageMatchScore(file, sinceMs, text);
      if (score <= 0 && text.trim()) continue;
      const metaCwd = validLocalDirectory(readSessionMeta(file).cwd || '');
      if (expectedCwd) {
        if (metaCwd !== expectedCwd) continue;
        score += 35;
      }
      score += Math.max(0, Math.min(20, Math.round((stat.mtimeMs - sinceMs) / 1000) + 10));
      if (!best || score > best.score || (score === best.score && stat.mtimeMs > best.mtimeMs)) {
        best = { file, score, mtimeMs: stat.mtimeMs };
      }
    } catch {
      // ignore disappearing files
    }
  }
  return best && best.file;
}

async function waitForCodexSessionFileForNewSend(options = {}, timeoutMs = 2600) {
  const deadline = Date.now() + timeoutMs;
  let file = null;
  while (Date.now() <= deadline) {
    file = findCodexSessionFileForNewSend(options);
    if (file) return file;
    await delay(220);
  }
  return findCodexSessionFileForNewSend(options);
}

function readJsonlTailObjects(file, maxBytes) {
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  const cacheKey = stat && maxBytes <= CODEX_TAIL_CACHE_MAX_BYTES ? `${file}:${fileCacheSignature(stat)}:${maxBytes}:objects` : '';
  if (cacheKey && jsonlTailObjectsCache.has(cacheKey)) return jsonlTailObjectsCache.get(cacheKey);
  try {
    const objects = readTailLinesWithLimit(file, maxBytes, stat).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    return cacheKey ? boundedSet(jsonlTailObjectsCache, cacheKey, objects, 80) : objects;
  } catch {
    return [];
  }
}

function summarizeCodexRuntimeItems(items, stat = null) {
  let status = 'idle';
  let active = false;
  let startedAt = '';
  let completedAt = '';
  let updatedAt = stat ? new Date(stat.mtimeMs).toISOString() : '';
  let turnId = '';
  let sawRuntimeActivity = false;
  let sawTaskMarker = false;

  for (const item of items) {
    const payload = item.payload || {};
    if (item.timestamp) updatedAt = item.timestamp;
    if (item.type === 'response_item' || (item.type === 'event_msg' && payload.type && !String(payload.type).startsWith('task_'))) {
      sawRuntimeActivity = true;
    }
    if (item.type === 'turn_context' && payload.turn_id) turnId = payload.turn_id;
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      sawTaskMarker = true;
      status = 'running';
      active = true;
      startedAt = item.timestamp || startedAt;
      completedAt = '';
      turnId = payload.turn_id || turnId;
      updatedAt = item.timestamp || updatedAt;
    }
    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      sawTaskMarker = true;
      status = 'complete';
      active = false;
      completedAt = item.timestamp || completedAt;
      updatedAt = item.timestamp || updatedAt;
    }
    if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      sawTaskMarker = true;
      status = 'error';
      active = false;
      completedAt = item.timestamp || completedAt;
      turnId = payload.turn_id || turnId;
      updatedAt = item.timestamp || updatedAt;
    }
  }

  return { status, active, startedAt, completedAt, updatedAt, turnId, sawRuntimeActivity, sawTaskMarker };
}

function quickCodexRuntimeFromFile(file, stat = null) {
  let fileStat = stat;
  if (!fileStat) {
    try { fileStat = fs.statSync(file); } catch { fileStat = null; }
  }
  const cacheKey = fileStat ? `${file}:${fileCacheSignature(fileStat)}` : '';
  if (cacheKey && runtimeSummaryCache.has(cacheKey)) return runtimeSummaryCache.get(cacheKey);
  const isFresh = fileStat ? Date.now() - fileStat.mtimeMs <= CODEX_RUNTIME_STALE_MS : false;
  let runtime = summarizeCodexRuntimeItems(readJsonlTailObjects(file, CODEX_ACTIVITY_TAIL_BYTES), fileStat);

  if (
    runtime.status === 'idle' &&
    runtime.sawRuntimeActivity &&
    !runtime.sawTaskMarker &&
    isFresh &&
    fileStat &&
    fileStat.size > CODEX_ACTIVITY_TAIL_BYTES
  ) {
    runtime = summarizeCodexRuntimeItems(readJsonlTailObjects(file, CODEX_ACTIVITY_LOOKBACK_BYTES), fileStat);
  }

  if (runtime.status === 'idle' && runtime.sawRuntimeActivity && !runtime.sawTaskMarker && isFresh) {
    runtime.status = 'running';
    runtime.active = true;
  }
  if (runtime.status === 'running' && fileStat && !isFresh) {
    runtime.status = 'idle';
    runtime.active = false;
  }

  const { status, active, startedAt, completedAt, updatedAt, turnId } = runtime;
  return cacheKey
    ? boundedSet(runtimeSummaryCache, cacheKey, { status, active, startedAt, completedAt, updatedAt, turnId }, 600)
    : { status, active, startedAt, completedAt, updatedAt, turnId };
}

function displayPathName(cwd) {
  if (!cwd) return '对话';
  const normalized = path.normalize(cwd);
  if (normalized === os.homedir()) return '~';
  if (normalized === path.parse(normalized).root) return normalized;
  return path.basename(normalized) || normalized;
}

function classifyThreadProject(cwd) {
  const normalized = cwd ? path.normalize(cwd) : '';
  const codexScratchRoot = path.join(os.homedir(), 'Documents', 'Codex');
  const relativeToScratch = normalized ? path.relative(codexScratchRoot, normalized) : '';
  const isGeneratedProjectless = Boolean(
    normalized &&
    relativeToScratch &&
    !relativeToScratch.startsWith('..') &&
    !path.isAbsolute(relativeToScratch) &&
    /^\d{4}-\d{2}-\d{2}(?:$|[\/])/.test(relativeToScratch)
  );

  if (!normalized || isGeneratedProjectless) {
    return {
      isProjectThread: false,
      projectKey: 'conversation',
      projectName: '对话',
      projectPath: '',
    };
  }

  return {
    isProjectThread: true,
    projectKey: normalized,
    projectName: displayPathName(normalized),
    projectPath: normalized,
  };
}

function listCodexThreads(limit = 80) {
  const normalizedLimit = Math.max(1, Math.min(160, Number(limit) || 80));
  const cacheKey = String(normalizedLimit);
  const cached = codexThreadListCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= CODEX_THREAD_LIST_CACHE_MS) return cached.threads;
  const stateSnapshot = readCodexState();
  const pinnedThreadIds = new Set(stateSnapshot.pinnedThreadIds || []);
  const archivedThreadIds = new Set(stateSnapshot.archivedThreadIds || []);
  const titleOverrides = stateSnapshot.titleOverrides || {};
  const byId = readThreadIndex();
  for (const file of listCodexSessionFiles()) {
    const match = path.basename(file).match(/([a-f0-9]{8}-[a-f0-9-]{27,})\.jsonl$/i);
    if (!match) continue;
    const id = match[1];
    try {
      const stat = fs.statSync(file);
      const meta = readSessionMeta(file);
      const runtime = quickCodexRuntimeFromFile(file, stat);
      const project = classifyThreadProject(meta.cwd || '');
      const existing = byId.get(id) || { id, name: '', updatedAt: '' };
      const fallbackName = isPlaceholderThreadName(existing.name) ? findFirstCodexUserMessage(file) : '';
      existing.name = isPlaceholderThreadName(existing.name) ? (fallbackName || '未命名线程') : existing.name;
      existing.nameSource = fallbackName && existing.name === fallbackName ? 'first_user_message' : 'index';
      const override = titleOverrides[id];
      if (override && typeof override.name === 'string' && override.name.trim()) {
        const overrideTime = Date.parse(override.renamedAt || '') || 0;
        const indexTime = Date.parse(existing.updatedAt || '') || 0;
        if (!indexTime || !overrideTime || indexTime <= overrideTime + 2000 || existing.name === override.name || isPlaceholderThreadName(existing.name)) {
          existing.name = override.name.trim();
          existing.nameSource = 'codex_override';
        }
      }
      existing.sessionFile = path.basename(file);
      existing.mtimeMs = stat.mtimeMs;
      existing.updatedAt = existing.updatedAt || meta.timestamp || new Date(stat.mtimeMs).toISOString();
      existing.effectiveUpdatedMs = Math.max(Date.parse(existing.updatedAt) || 0, stat.mtimeMs || 0);
      existing.cwd = meta.cwd || '';
      existing.source = meta.source || '';
      existing.threadSource = meta.thread_source || '';
      existing.runtimeStatus = runtime.status;
      existing.runtimeActive = runtime.active;
      existing.runtimeStartedAt = runtime.startedAt;
      existing.runtimeCompletedAt = runtime.completedAt;
      existing.runtimeUpdatedAt = runtime.updatedAt;
      existing.runtimeTurnId = runtime.turnId;
      existing.pinned = pinnedThreadIds.has(id);
      Object.assign(existing, project);
      byId.set(id, existing);
    } catch {}
  }
  const threads = [...byId.values()]
    .filter(item => item.sessionFile && !archivedThreadIds.has(item.id))
    .map(item => {
      const effectiveUpdatedMs = item.effectiveUpdatedMs || Math.max(Date.parse(item.updatedAt) || 0, item.mtimeMs || 0);
      return { ...item, effectiveUpdatedMs, effectiveUpdatedAt: new Date(effectiveUpdatedMs).toISOString() };
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.effectiveUpdatedMs - a.effectiveUpdatedMs)
    .slice(0, normalizedLimit);
  boundedSet(codexThreadListCache, cacheKey, { at: Date.now(), threads }, 20);
  return threads;
}

function handleThreads(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const limit = Math.max(1, Math.min(160, Number(url.searchParams.get('limit')) || 80));
  return json(res, 200, { ok: true, threads: listCodexThreads(limit) });
}

function readTailLines(file) {
  return readTailLinesWithLimit(file, CODEX_SESSION_TAIL_BYTES);
}

function readTailLinesWithLimit(file, maxBytes, knownStat = null) {
  const stat = knownStat || fs.statSync(file);
  const cacheKey = stat && maxBytes <= CODEX_TAIL_CACHE_MAX_BYTES ? `${file}:${fileCacheSignature(stat)}:${maxBytes}:lines` : '';
  if (cacheKey && jsonlTailLinesCache.has(cacheKey)) return jsonlTailLinesCache.get(cacheKey);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    const lines = text.split('\n').filter(Boolean);
    return cacheKey ? boundedSet(jsonlTailLinesCache, cacheKey, lines, 80) : lines;
  } finally {
    fs.closeSync(fd);
  }
}

function countCodexHistoryMessages(lines, maxNeeded = MAX_HISTORY_MESSAGES) {
  let count = 0;
  let currentTurn = null;
  const need = Math.max(1, Math.min(Number(maxNeeded) || MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGES));
  for (const line of lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const payload = item.payload || {};
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      currentTurn = { hasAssistant: false };
      continue;
    }
    if (item.type === 'event_msg' && payload.type === 'user_message') {
      const text = cleanUserHistoryText(payload.message);
      const attachments = extractUserAttachments(payload);
      if (text || attachments.length) count += 1;
    } else if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant' && payload.phase === 'final_answer') {
      const text = normalizeHistoryText(extractMessageText(payload.content));
      if (text) {
        count += 1;
        if (currentTurn) currentTurn.hasAssistant = true;
      }
    } else if (item.type === 'event_msg' && payload.type === 'task_complete') {
      const lastMessage = normalizeHistoryText(payload.last_agent_message || '');
      if (currentTurn && !currentTurn.hasAssistant) count += lastMessage ? 1 : 1;
      currentTurn = null;
    } else if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      if (currentTurn && !currentTurn.hasAssistant) count += 1;
      currentTurn = null;
    }
    if (count >= need) return count;
  }
  return count;
}

function readHistoryLinesAdaptive(file, desiredMessages = MAX_HISTORY_MESSAGES) {
  const stat = fs.statSync(file);
  const maxBytes = Math.min(stat.size, CODEX_HISTORY_TAIL_BYTES);
  const desired = Math.max(1, Math.min(Number(desiredMessages) || MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGES));

  if (maxBytes <= CODEX_HISTORY_INITIAL_TAIL_BYTES * 6) {
    return { lines: readTailLinesWithLimit(file, maxBytes), stat, scannedBytes: maxBytes };
  }

  const initialBytes = Math.min(CODEX_HISTORY_INITIAL_TAIL_BYTES, maxBytes);
  const initialLines = readTailLinesWithLimit(file, initialBytes);
  if (countCodexHistoryMessages(initialLines, desired) >= desired) {
    return { lines: initialLines, stat, scannedBytes: initialBytes };
  }

  return { lines: readTailLinesWithLimit(file, maxBytes), stat, scannedBytes: maxBytes };
}

function extractUserAttachments(payload) {
  const paths = [];
  for (const key of ['local_images', 'images']) {
    if (!Array.isArray(payload[key])) continue;
    for (const item of payload[key]) {
      if (typeof item === 'string') paths.push(item);
      else if (item && typeof item.path === 'string') paths.push(item.path);
      else if (item && typeof item.filePath === 'string') paths.push(item.filePath);
    }
  }
  return paths;
}

function parseCodexThreadHistory(threadId, limit = MAX_HISTORY_MESSAGES) {
  const file = findCodexSessionFileByThreadId(threadId);
  if (!file) {
    return {
      ok: true,
      available: false,
      threadId,
      sessionFile: '',
      messages: [],
      message: '没有找到所选线程的 Codex 会话文件。',
    };
  }
  let fileStat;
  try { fileStat = fs.statSync(file); } catch { fileStat = null; }
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGES));
  const cacheKey = fileStat ? `${threadId}:${normalizedLimit}:${file}:${fileCacheSignature(fileStat)}` : '';
  const cached = cacheKey ? codexThreadHistoryCache.get(cacheKey) : null;
  if (cached && Date.now() - cached.at <= CODEX_HISTORY_RESPONSE_CACHE_MS) return cached.result;

  const messages = [];
  let currentTurn = null;
  function historyDurationText(startedAt = '', completedAt = '') {
    const startMs = Date.parse(startedAt || '');
    const endMs = Date.parse(completedAt || '');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '';
    const total = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }
  function historyCompleteLabel(startedAt = '', completedAt = '') {
    const duration = historyDurationText(startedAt, completedAt);
    return duration ? `Codex · 已处理 ${duration}` : 'Codex';
  }
  function historyFailureLabel(startedAt = '', completedAt = '') {
    const duration = historyDurationText(startedAt, completedAt);
    return duration ? `Codex · 失败 ${duration}` : 'Codex';
  }
  const historyTail = readHistoryLinesAdaptive(file, normalizedLimit);
  for (const line of historyTail.lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const payload = item.payload || {};

    if (item.type === 'event_msg' && payload.type === 'task_started') {
      currentTurn = { hasAssistant: false, assistantIndex: -1, failureText: '', startedAt: item.timestamp || '', turnId: payload.turn_id || '' };
      continue;
    }

    if (currentTurn && item.type === 'event_msg') {
      currentTurn.failureText = currentTurn.failureText || extractFailureTextFromPayload(payload);
    }

    if (currentTurn && item.type === 'turn_context') {
      currentTurn.turnId = payload.turn_id || currentTurn.turnId;
    }

    if (item.type === 'event_msg' && payload.type === 'user_message') {
      const text = cleanUserHistoryText(payload.message);
      const attachments = extractUserAttachments(payload);
      if (text || attachments.length) {
        messages.push({
          role: 'user',
          label: attachments.length ? `你 · ${attachments.length} 张图片` : '你',
          text: text || (attachments.length ? ' ' : ''),
          attachments: attachments.map(filePath => ({ filePath, name: path.basename(filePath) })),
          timestamp: item.timestamp || '',
        });
      }
      continue;
    }

    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const isFinal = payload.phase === 'final_answer';
      if (!isFinal) continue;
      const text = normalizeHistoryText(extractMessageText(payload.content));
      if (text) {
        const assistantIndex = messages.length;
        messages.push({
          role: 'assistant',
          label: 'Codex',
          text,
          timestamp: item.timestamp || '',
        });
        if (currentTurn) {
          currentTurn.hasAssistant = true;
          currentTurn.assistantIndex = assistantIndex;
        }
      }
      continue;
    }

    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      const lastMessage = normalizeHistoryText(payload.last_agent_message || '');
      const completedAt = item.timestamp || '';
      if (currentTurn && !currentTurn.hasAssistant) {
        const failureText = resolveFailureTextForTurn(threadId, {
          turnId: currentTurn.turnId || '',
          startedAt: currentTurn.startedAt || '',
          completedAt,
          failureText: currentTurn.failureText || '',
        });
        messages.push({
          role: 'assistant',
          label: failureText ? historyFailureLabel(currentTurn.startedAt, completedAt) : historyCompleteLabel(currentTurn.startedAt, completedAt),
          text: lastMessage || failureText || emptyCodexFailureText(),
          timestamp: completedAt || currentTurn.startedAt || '',
        });
      } else if (currentTurn && currentTurn.hasAssistant && currentTurn.assistantIndex >= 0 && messages[currentTurn.assistantIndex]) {
        messages[currentTurn.assistantIndex].label = historyCompleteLabel(currentTurn.startedAt, completedAt);
      }
      currentTurn = null;
    }

    if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      const failureText = normalizeHistoryText(extractFailureTextFromPayload(payload) || currentTurn?.failureText || '');
      if (currentTurn && !currentTurn.hasAssistant) {
        messages.push({
          role: 'assistant',
          label: historyFailureLabel(currentTurn.startedAt, item.timestamp || ''),
          text: failureText || emptyCodexFailureText(),
          timestamp: item.timestamp || currentTurn.startedAt || '',
        });
      } else if (currentTurn && currentTurn.hasAssistant && currentTurn.assistantIndex >= 0 && messages[currentTurn.assistantIndex]) {
        messages[currentTurn.assistantIndex].label = historyFailureLabel(currentTurn.startedAt, item.timestamp || '');
      }
      currentTurn = null;
    }
  }

  const result = {
    ok: true,
    available: true,
    threadId,
    sessionFile: path.basename(file),
    truncated: historyTail.stat.size > CODEX_HISTORY_TAIL_BYTES,
    messages: messages.slice(-normalizedLimit),
  };
  return cacheKey ? boundedSet(codexThreadHistoryCache, cacheKey, { at: Date.now(), result }, 60).result : result;
}

function handleThreadHistory(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const threadId = url.searchParams.get('thread') || '';
    if (!isCodexThreadId(threadId)) {
      return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
    }
    return json(res, 200, parseCodexThreadHistory(threadId, url.searchParams.get('limit') || MAX_HISTORY_MESSAGES));
  } catch (error) {
    return json(res, 500, { ok: false, code: 'CODEX_HISTORY_FAILED', message: '读取 Codex 聊天记录失败。', detail: String(error && error.message || error) });
  }
}

function extractReasoningText(payload) {
  const parts = [];
  if (Array.isArray(payload.summary)) {
    for (const item of payload.summary) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item.text === 'string') parts.push(item.text);
      else if (item && typeof item.summary === 'string') parts.push(item.summary);
    }
  }
  if (Array.isArray(payload.content)) {
    for (const item of payload.content) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item.text === 'string') parts.push(item.text);
    }
  }
  if (typeof payload.text === 'string') parts.push(payload.text);
  const visible = parts.map(x => String(x).trim()).filter(Boolean).join('\n');
  return visible;
}

function parseToolArguments(payload) {
  const raw = payload.arguments || payload.input || '';
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { raw: String(raw) }; }
}

function shellQuotePattern() {
  return String.raw`(?:(?:"[^"]+")|(?:'[^']+')|(?:\\\S|\S)+)`;
}

function stripShellQuotes(value) {
  let text = String(value || '').trim();
  while ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text.replace(/\\([\s"'])/g, '$1');
}

function shortPath(value) {
  const text = stripShellQuotes(value).replace(/^~\//, '~/');
  if (!text) return '';
  const home = os.homedir();
  const normalized = text.startsWith(home) ? `~${text.slice(home.length)}` : text;
  if (/^[./~\w-].*\.(?:js|ts|tsx|jsx|html|css|json|jsonl|md|txt|sh|swift|py|yml|yaml|webmanifest|png|jpg|jpeg|gif|svg)$/i.test(normalized)) {
    return normalized.replace(/^\.\//, '');
  }
  return normalized.replace(/^\.\//, '');
}


function isLikelyToolFile(value) {
  const text = stripShellQuotes(value);
  if (!text || text.startsWith('-') || text.startsWith('<') || /^\d+$/.test(text)) return false;
  if (/^[A-Z_]+$/.test(text)) return false;
  return /[./~]/.test(text) || /\.[A-Za-z0-9]{1,12}$/.test(text);
}

function uniqueList(values, limit = 3) {
  const out = [];
  for (const value of values) {
    const text = shortPath(value);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function joinToolTargets(values) {
  const list = uniqueList(values, 4);
  if (!list.length) return '';
  return list.join(', ');
}

function extractCommandFiles(cmd) {
  const files = [];
  const token = shellQuotePattern();
  const commandPatterns = [
    new RegExp(String.raw`\bsed\s+(?:-[A-Za-z]+\s+)?${token}\s+(${token})`, 'g'),
    new RegExp(String.raw`\bnl\s+(?:-[A-Za-z]+\s+)*(${token})`, 'g'),
    new RegExp(String.raw`\b(?:cat|head|tail)\s+(?:-[A-Za-z0-9]+\s+)*(?:-n\s+\d+\s+)?(${token})`, 'g'),
  ];
  for (const re of commandPatterns) {
    let match;
    while ((match = re.exec(cmd))) files.push(match[1]);
  }
  const redirectMatch = cmd.match(/<\s*([^\s|;&]+)/);
  if (redirectMatch && !/<<\s*$/.test(cmd.slice(Math.max(0, redirectMatch.index - 3), redirectMatch.index + 1))) files.push(redirectMatch[1]);
  return uniqueList(files.filter(isLikelyToolFile), 4);
}

function extractSearchTargets(cmd) {
  const afterGlob = cmd.replace(/--glob\s+(?:"[^"]+"|'[^']+'|\S+)/g, '');
  const matches = [...afterGlob.matchAll(/(?:^|\s)([./~\w-][^\s|;&]*\.(?:js|ts|tsx|jsx|html|css|json|jsonl|md|txt|sh|swift|py|yml|yaml|webmanifest))(?:\s|$)/gi)];
  return uniqueList(matches.map(match => match[1]), 4);
}

function truncateCommand(cmd, max = 120) {
  const oneLine = String(cmd || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  const home = os.homedir();
  const text = oneLine.startsWith(home) ? `~${oneLine.slice(home.length)}` : oneLine.replace(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function patchStats(patch) {
  const files = [];
  let added = 0;
  let removed = 0;
  for (const line of String(patch || '').split('\n')) {
    const fileMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/) || line.match(/^@@\s+(.+?)\s*$/);
    if (fileMatch && !fileMatch[1].startsWith('@@')) files.push(fileMatch[1].trim());
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('***')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { files: uniqueList(files, 3), added, removed };
}

function formatToolCall(payload, options = {}) {
  const rawName = String(payload.name || 'tool');
  const name = rawName.split('.').pop();
  const args = parseToolArguments(payload);

  if (name === 'exec_command') {
    const cmd = String(args.cmd || args.raw || '').trim();
    const files = extractCommandFiles(cmd);
    if (files.length) return `Read ${files.join(', ')}`;

    if (/\b(?:rg|grep)\b/.test(cmd)) {
      const targets = joinToolTargets(extractSearchTargets(cmd));
      return targets ? `Search ${targets}` : 'Search project files';
    }
    if (/\bfind\b/.test(cmd)) return 'Find files';
    if (/\bls\b/.test(cmd)) return 'List files';
    if (/\bgit\s+diff\b/.test(cmd)) return `Review diff${joinToolTargets(extractSearchTargets(cmd)) ? ` in ${joinToolTargets(extractSearchTargets(cmd))}` : ''}`;
    if (/\bgit\s+status\b/.test(cmd)) return 'Check git status';
    if (/\bgit\b/.test(cmd)) return `Run git: ${truncateCommand(cmd, 90)}`;
    if (/\b(?:node --check|npm run check)\b/.test(cmd)) return 'Run checks';
    if (/\bcurl\b/.test(cmd)) return `Check endpoint: ${truncateCommand(cmd, 100)}`;
    if (/\b(?:npm start|node\s+server\.js)\b/.test(cmd)) return 'Start local service';
    if (/\b(?:osascript|cliclick|open -b com\.openai\.codex)\b/.test(cmd)) return 'Control Codex desktop';
    if (/\.codex\/sessions|session_index\.jsonl|Codex session/.test(cmd)) return 'Inspect Codex session log';
    if (/\b(?:python3|node\s+-)\b/.test(cmd)) return `Run script: ${truncateCommand(cmd, 90)}`;
    return `Run: ${truncateCommand(cmd) || 'local command'}`;
  }

  if (name === 'apply_patch') {
    const patch = typeof args.raw === 'string' ? args.raw : String(payload.arguments || '');
    const stats = patchStats(patch);
    const target = stats.files.length ? stats.files.join(', ') : 'files';
    const delta = stats.added || stats.removed ? ` +${stats.added} -${stats.removed}` : '';
    return `${options.complete ? '已编辑' : '正在编辑'} ${target}${delta}`;
  }

  if (name === 'write_stdin') return 'Read command output';
  if (name === 'view_image') return `View image${args.path ? ` ${shortPath(args.path)}` : ''}`;
  if (name === 'read_mcp_resource') return `Read resource${args.uri ? ` ${shortPath(args.uri)}` : ''}`;
  if (name.includes('browser') || name.includes('chrome')) return 'Check browser page';
  return `${rawName}${Object.keys(args).length ? ` ${truncateText(JSON.stringify(args), 120)}` : ''}`;
}


function contextUsageFromItems(items) {
  let windowTokens = 0;
  let latestUsage = null;
  let updatedAt = '';

  for (const item of items) {
    const payload = item.payload || {};
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      const value = Number(payload.model_context_window || 0);
      if (Number.isFinite(value) && value > 0) windowTokens = value;
    }
    if (item.type !== 'event_msg' || payload.type !== 'token_count') continue;
    const info = payload.info || {};
    const value = Number(info.model_context_window || 0);
    if (Number.isFinite(value) && value > 0) windowTokens = value;
    const usage = info.last_token_usage || info.current_token_usage || null;
    if (usage && typeof usage === 'object') {
      latestUsage = usage;
      updatedAt = item.timestamp || updatedAt;
    }
  }

  if (!latestUsage || !windowTokens) {
    return {
      available: false,
      usedTokens: 0,
      windowTokens: windowTokens || 0,
      remainingTokens: windowTokens || 0,
      percent: null,
      updatedAt,
    };
  }

  const inputTokens = Number(latestUsage.input_tokens || 0) || 0;
  const outputTokens = Number(latestUsage.output_tokens || 0) || 0;
  const totalTokens = Number(latestUsage.total_tokens || 0) || 0;
  let usedTokens = totalTokens || (inputTokens + outputTokens) || inputTokens;
  if (usedTokens > windowTokens * 1.15 && inputTokens > 0 && inputTokens <= windowTokens * 1.15) {
    usedTokens = inputTokens + outputTokens;
  }
  usedTokens = Math.max(0, Math.round(usedTokens));
  const percent = Math.max(0, Math.min(100, (usedTokens / windowTokens) * 100));

  return {
    available: true,
    usedTokens,
    windowTokens,
    remainingTokens: Math.max(0, Math.round(windowTokens - usedTokens)),
    percent,
    updatedAt,
  };
}

function modelInfoFromId(modelId = '', updatedAt = '') {
  const id = String(modelId || '').trim();
  const option = findModelOption(id);
  if (option) return { available: true, id, version: '', source: option.source || 'local', label: option.label, displayName: option.displayName, updatedAt };

  if (id === 'gpt-5.5') return { available: true, id, version: '5.5', source: 'official', label: '5.5', displayName: 'GPT-5.5', updatedAt };
  if (id === 'gpt-5.4') return { available: true, id, version: '5.4', source: 'official', label: '5.4', displayName: 'GPT-5.4', updatedAt };
  if (id === 'gpt-5.4-mini') return { available: true, id, version: 'mini', source: 'official', label: 'mini', displayName: 'GPT-5.4-Mini', updatedAt };
  if (id === 'gpt-5.3-codex') return { available: true, id, version: '5.3', source: 'official', label: '5.3', displayName: 'GPT-5.3-Codex', updatedAt };
  if (id === 'gpt-5.2') return { available: true, id, version: '5.2', source: 'official', label: '5.2', displayName: 'GPT-5.2', updatedAt };

  return {
    available: Boolean(id),
    id,
    version: '',
    source: id.startsWith('gpt-') ? 'official' : id ? 'unknown' : '',
    label: '',
    displayName: id,
    updatedAt,
  };
}

function currentModelFromItems(items) {
  let modelId = '';
  let updatedAt = '';
  for (const item of items) {
    const payload = item.payload || {};
    if (item.type === 'session_meta' && payload.model) {
      modelId = payload.model;
      updatedAt = item.timestamp || payload.timestamp || updatedAt;
    }
    if (item.type === 'turn_context' && payload.model) {
      modelId = payload.model;
      updatedAt = item.timestamp || updatedAt;
    }
  }
  return modelInfoFromId(modelId, updatedAt);
}

function reasoningModeFromValue(value = '', updatedAt = '') {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    low: 'low',
    '低': 'low',
    medium: 'medium',
    med: 'medium',
    middle: 'medium',
    '中': 'medium',
    high: 'high',
    '高': 'high',
    xhigh: 'xhigh',
    'x-high': 'xhigh',
    'extra-high': 'xhigh',
    extreme: 'xhigh',
    max: 'xhigh',
    '超高': 'xhigh',
    '极高': 'xhigh',
  };
  const key = aliases[raw] || '';
  const target = key ? REASONING_MODE_TARGETS[key] : null;
  return {
    available: Boolean(target || raw),
    key: target?.key || '',
    value: target?.value || raw,
    label: target?.label || '',
    displayName: target?.displayName || value || '',
    updatedAt,
  };
}

function currentReasoningModeFromItems(items) {
  let value = '';
  let updatedAt = '';
  for (const item of items) {
    const payload = item.payload || {};
    const settings = payload.collaboration_mode && typeof payload.collaboration_mode === 'object'
      ? payload.collaboration_mode.settings || {}
      : {};
    const reasoning = payload.reasoning && typeof payload.reasoning === 'object' ? payload.reasoning : {};
    const next = payload.reasoning_effort || payload.reasoningMode || payload.reasoning_mode || settings.reasoning_effort || reasoning.effort || '';
    if (item.type === 'turn_context' && next) {
      value = next;
      updatedAt = item.timestamp || updatedAt;
    }
  }
  return reasoningModeFromValue(value, updatedAt);
}

function stepFromEvent(item) {
  const payload = item.payload || {};
  if (item.type === 'event_msg') {
    const failureText = extractFailureTextFromPayload(payload);
    if (failureText) return { kind: 'error', label: '失败', text: failureText, time: item.timestamp };
    if (payload.type === 'task_started') return { kind: 'start', label: '开始', text: '开始处理这条消息', time: item.timestamp };
    if (payload.type === 'task_complete') return { kind: 'complete', label: '完成', text: '回复完成', time: item.timestamp };
    if (payload.type === 'agent_message' && payload.message) {
      return { kind: 'thinking', label: '思考', text: String(payload.message).trim(), time: item.timestamp };
    }
    return null;
  }

  if (item.type === 'response_item') {
    if (payload.type === 'reasoning') {
      const text = extractReasoningText(payload);
      return text ? { kind: 'thinking', label: '思考', text, time: item.timestamp } : null;
    }
    if (payload.type === 'function_call') {
      const toolName = payload.name || 'tool';
      return { kind: 'tool', label: '工具', text: formatToolCall(payload), callId: payload.call_id || '', time: item.timestamp };
    }
    if (payload.type === 'message') {
      const text = extractMessageText(payload.content);
      if (text && payload.role === 'assistant' && payload.phase === 'commentary') return { kind: 'thinking', label: '思考', text: truncateText(text, 1200), time: item.timestamp };
      if (text && payload.role === 'assistant') return { kind: payload.phase === 'final_answer' ? 'final' : 'assistant', label: '回复', text: truncateText(text, 1200), time: item.timestamp };
    }
  }
  return null;
}

function parseCodexStatus(options = {}) {
  const sinceMs = options.since ? Date.parse(options.since) : 0;
  const wantsExactSession = Boolean(options.threadId || options.sessionFile);
  const requestedFile = options.threadId ? findCodexSessionFileByThreadId(options.threadId) : options.sessionFile ? findCodexSessionFileByName(options.sessionFile) : null;
  const file = requestedFile || (wantsExactSession ? null : findLatestCodexSessionFile({
    afterMs: options.expectNewThread ? sinceMs : 0,
    excludeThreadId: options.excludeThreadId || '',
    cwd: options.cwd || '',
  }));
  if (!file) {
    return {
      ok: true,
      available: false,
      active: Boolean(options.expectNewThread && sinceMs),
      status: wantsExactSession ? 'missing' : options.expectNewThread && sinceMs ? 'waiting' : 'idle',
      threadId: options.threadId || '',
      sessionFile: options.sessionFile || '',
      message: wantsExactSession ? '没有找到所选线程的 Codex 会话文件。' : '还没有找到 Codex 会话文件。',
      steps: [],
      preview: options.expectNewThread && sinceMs ? '已发送，等待 Codex 创建新线程记录…' : '还没有找到这个线程的回复记录。',
      final: '',
      durationMs: 0,
    };
  }

  const rawItems = [];
  for (const line of readTailLines(file)) {
    try { rawItems.push(JSON.parse(line)); } catch { /* ignore partial/corrupt lines */ }
  }

  let startIndex = -1;
  if (sinceMs) {
    for (let i = 0; i < rawItems.length; i += 1) {
      const t = Date.parse(rawItems[i].timestamp || '');
      if (Number.isFinite(t) && t >= sinceMs) {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex < 0) {
    for (let i = rawItems.length - 1; i >= 0; i -= 1) {
      if (rawItems[i].type === 'event_msg' && rawItems[i].payload && rawItems[i].payload.type === 'task_started') {
        startIndex = i;
        break;
      }
    }
  }
  if (startIndex < 0) startIndex = Math.max(0, rawItems.length - 80);

  // If watching a specific send, begin at the first task_started after that send when possible.
  if (sinceMs) {
    for (let i = startIndex; i < rawItems.length; i += 1) {
      const item = rawItems[i];
      const t = Date.parse(item.timestamp || '');
      if (Number.isFinite(t) && t >= sinceMs && item.type === 'event_msg' && item.payload && item.payload.type === 'task_started') {
        startIndex = i;
        break;
      }
    }
  }

  const turnItems = rawItems.slice(startIndex).filter(item => {
    if (!sinceMs) return true;
    const t = Date.parse(item.timestamp || '');
    return !Number.isFinite(t) || t >= sinceMs;
  });

  let active = Boolean(sinceMs);
  let completed = false;
  let turnId = null;
  let final = '';
  let preview = '';
  let startedAt = '';
  let completedAt = '';
  let sawTaskStarted = false;
  let failureText = '';
  let emptyComplete = false;
  const steps = [];
  const seenThinking = new Set();
  const toolCallsById = new Map();
  const toolStepIndexById = new Map();

  for (const item of turnItems) {
    const payload = item.payload || {};
    failureText = failureText || extractFailureTextFromPayload(payload);
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      active = true;
      sawTaskStarted = true;
      turnId = payload.turn_id || turnId;
      startedAt = startedAt || item.timestamp || '';
    }
    if (item.type === 'turn_context') turnId = payload.turn_id || turnId;
    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      active = false;
      completed = true;
      completedAt = item.timestamp || completedAt;
      const lastMessage = normalizeHistoryText(payload.last_agent_message || '');
      final = lastMessage || final;
      if (!lastMessage && !final && !preview && sawTaskStarted) emptyComplete = true;
    }
    if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      active = false;
      completed = true;
      completedAt = item.timestamp || completedAt;
      turnId = payload.turn_id || turnId;
    }

    if (item.type === 'response_item' && payload.type === 'function_call_output' && payload.call_id && toolStepIndexById.has(payload.call_id)) {
      const callPayload = toolCallsById.get(payload.call_id);
      if (callPayload && String(callPayload.name || '').split('.').pop() === 'apply_patch') {
        const stepIndex = toolStepIndexById.get(payload.call_id);
        if (steps[stepIndex]) steps[stepIndex].text = formatToolCall(callPayload, { complete: true });
      }
    }

    const step = stepFromEvent(item);
    if (!step) continue;
    if (step.kind === 'thinking') {
      const key = step.text || 'thinking';
      if (seenThinking.has(key)) continue;
      seenThinking.add(key);
    }
    if ((step.kind === 'assistant' || step.kind === 'final') && step.text) preview = step.text;
    if (step.kind === 'final' && step.text) final = step.text;
    if (['start', 'thinking', 'tool', 'complete', 'error'].includes(step.kind)) {
      if (step.kind === 'tool' && step.callId) {
        toolCallsById.set(step.callId, payload);
        toolStepIndexById.set(step.callId, steps.length);
      }
      steps.push(step);
    }
  }

  const context = contextUsageFromItems(rawItems);
  const model = currentModelFromItems(rawItems);
  const reasoningMode = currentReasoningModeFromItems(rawItems);
  const threadId = threadIdFromSessionFile(file);
  const failed = completed && !final && (emptyComplete || Boolean(failureText));
  const finalFailureText = failed
    ? (resolveFailureTextForTurn(threadId, { turnId, startedAt, completedAt, failureText }) || emptyCodexFailureText())
    : '';
  const statusSteps = steps.slice(-30);
  if (failed && finalFailureText && !statusSteps.some(step => step.kind === 'error' && step.text === finalFailureText)) {
    statusSteps.push({ kind: 'error', label: '失败', text: finalFailureText, time: completedAt || new Date(fs.statSync(file).mtimeMs).toISOString() });
  }
  const lastStep = statusSteps[statusSteps.length - 1] || steps[steps.length - 1];
  const status = failed ? 'error' : completed ? 'complete' : active ? 'running' : 'idle';
  const waiting = sinceMs && !steps.length;
  const startMs = Date.parse(startedAt || '') || sinceMs || 0;
  const endMs = completedAt ? Date.parse(completedAt) : Date.now();
  const durationMs = startMs ? Math.max(0, endMs - startMs) : 0;
  return {
    ok: true,
    available: true,
    active: waiting ? true : active,
    status: waiting ? 'waiting' : status,
    turnId,
    sessionFile: path.basename(file),
    threadId,
    updatedAt: lastStep ? lastStep.time : new Date(fs.statSync(file).mtimeMs).toISOString(),
    startedAt,
    completedAt,
    durationMs,
    context,
    model,
    reasoningMode,
    processText: statusSteps.map(step => `${step.label || '事件'}：${step.text || ''}`).join('\\n'),
    preview: final || preview || finalFailureText || (waiting ? '已发送，等待 Codex 开始回复…' : active ? 'Codex 正在回复…' : '暂无可显示回复。'),
    final: final || '',
    error: finalFailureText,
    steps: statusSteps,
  };
}

function handleCodexStatus(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    return json(res, 200, parseCodexStatus({
      since: url.searchParams.get('since') || '',
      sessionFile: url.searchParams.get('session') || '',
      threadId: url.searchParams.get('thread') || '',
      expectNewThread: url.searchParams.get('expectNewThread') === '1',
      excludeThreadId: url.searchParams.get('excludeThread') || '',
      cwd: url.searchParams.get('cwd') || '',
    }));
  } catch (error) {
    return json(res, 500, { ok: false, code: 'CODEX_STATUS_FAILED', message: '读取 Codex 回复状态失败。', detail: String(error && error.message || error) });
  }
}

async function handleSelectThread(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  if (!isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    await activateCodexThread(threadId);
    return json(res, 200, { ok: true, threadId, message: '已切换到所选 Codex 线程。' });
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}


const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...corsHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-codex-token,x-mobile-typer-token',
    'access-control-allow-private-network': 'true',
  };
}

function options(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('输入太长了，请分段发送。'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeRemoteAccessKey(value = '') {
  return String(value || '').trim().replace(/\s+/g, '').slice(0, 80);
}

function readStartupControlConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return normalizeControlConfig(parsed?.controlConfig || {});
  } catch {
    return normalizeControlConfig({});
  }
}

function safeSecretEqual(a = '', b = '') {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function redactSecret(value = '') {
  const secret = String(value || '').trim();
  if (!secret) return '';
  if (secret.length <= 4) return '***';
  return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
}

function isRelayRequest(req) {
  return req.headers['x-codex-relay'] === '1';
}

function requestRemoteAddress(req) {
  return String(req.socket?.remoteAddress || '')
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '');
}

function isPrivateIpv4(address = '') {
  const parts = String(address || '').split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isLocalDirectRequest(req) {
  if (isRelayRequest(req)) return false;
  const address = requestRemoteAddress(req).toLowerCase();
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === 'localhost' ||
    address.startsWith('fe80:') ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    isPrivateIpv4(address)
  );
}

function requestAuthValues(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromHeader = req.headers['x-codex-token'] || req.headers['x-mobile-typer-token'];
  const fromQuery = url.searchParams.get('token');
  const cookies = parseCookies(req.headers.cookie || '');
  const fromCookie = cookies.codexToken;
  return [fromHeader, fromQuery, fromCookie].filter(Boolean);
}

function hasControlToken(req) {
  return requestAuthValues(req).some(value => safeSecretEqual(value, TOKEN));
}

function hasRemoteAccessKey(req) {
  if (!REMOTE_ACCESS_KEY) return false;
  return requestAuthValues(req).some(value => safeSecretEqual(normalizeRemoteAccessKey(value), REMOTE_ACCESS_KEY));
}

function isAuthorized(req) {
  if (isLocalDirectRequest(req)) return true;
  if (hasControlToken(req)) return true;
  if (isRelayRequest(req) && hasRemoteAccessKey(req)) return true;
  return false;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function cleanupRecentSendRequests() {
  const cutoff = Date.now() - RECENT_SEND_TTL_MS;
  for (const [id, entry] of recentSendRequests) {
    if (!entry || entry.createdAt < cutoff) recentSendRequests.delete(id);
  }
}

function normalizeClientRequestId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9._:-]{8,120}$/.test(id) ? id : '';
}

function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(stderr.trim() || `${command} exited with code ${code}`), { code, stdout, stderr }));
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function windowsPowerShellArgs(script, extraArgs = []) {
  return [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `& {\n${script}\n}`,
    ...extraArgs,
  ];
}

function runWindowsPowerShell(script, args = []) {
  return runProcess('powershell.exe', windowsPowerShellArgs(script, args));
}

function windowsSendKeysExpression(key, modifiers = []) {
  const prefix = [];
  for (const modifier of modifiers) {
    const normalized = String(modifier || '').toLowerCase();
    if (normalized === 'command' || normalized === 'control' || normalized === 'ctrl') prefix.push('^');
    else if (normalized === 'option' || normalized === 'alt') prefix.push('%');
    else if (normalized === 'shift') prefix.push('+');
  }
  const keyText = String(key || '');
  const escaped = keyText.length === 1
    ? keyText.replace(/[+^%~(){}[\]]/g, '{$&}')
    : `{${keyText.toUpperCase()}}`;
  return `${prefix.join('')}${escaped}`;
}

async function windowsOpenUri(uri) {
  try {
    await runProcess('rundll32.exe', ['url.dll,FileProtocolHandler', uri]);
  } catch (error) {
    await runWindowsPowerShell('Start-Process -FilePath $args[0]', [uri]);
  }
}

async function openSystemUri(uri) {
  if (IS_WINDOWS) {
    await windowsOpenUri(uri);
    return;
  }
  await runProcess('open', [uri]);
}

const WINDOWS_CODEX_WINDOW_SCRIPT = String.raw`
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@

$excluded = @('powershell','pwsh','windowsterminal','conhost','cmd','node','code','chrome','msedge','firefox')
$candidates = New-Object System.Collections.Generic.List[object]
[Win32]::EnumWindows({
  param([IntPtr]$hwnd, [IntPtr]$lparam)
  if (-not [Win32]::IsWindowVisible($hwnd)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
  $title = $sb.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $targetPid = 0
  [void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
  try { $process = Get-Process -Id $targetPid -ErrorAction Stop } catch { return $true }
  $name = $process.ProcessName
  $isCodexProcess = $name -match '(?i)codex'
  $isCodexTitle = $title -match '(?i)\bcodex\b'
  if ((-not $isCodexProcess) -and (-not $isCodexTitle)) { return $true }
  if ($excluded -contains $name.ToLowerInvariant()) { return $true }
  $rect = New-Object RECT
  if (-not [Win32]::GetWindowRect($hwnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 480 -or $height -lt 360) { return $true }
  $candidates.Add([pscustomobject]@{ Handle = $hwnd; Title = $title; Process = $name; ProcessId = $targetPid; SessionId = $process.SessionId; Left = $rect.Left; Top = $rect.Top; Width = $width; Height = $height; Area = $width * $height }) | Out-Null
  return $true
}, [IntPtr]::Zero) | Out-Null

$best = $candidates | Sort-Object Area -Descending | Select-Object -First 1
if (-not $best) {
  $processes = Get-Process | Where-Object { $_.ProcessName -match '(?i)codex' } | Select-Object -First 8 ProcessName, Id, SessionId, MainWindowTitle
  $processSummary = ($processes | ForEach-Object { "$($_.ProcessName)#$($_.Id) session=$($_.SessionId) title=$($_.MainWindowTitle)" }) -join '; '
  if (-not $processSummary) { $processSummary = 'none' }
  throw "No visible Codex window found. Codex processes: $processSummary"
}
[Win32]::ShowWindow($best.Handle, 9) | Out-Null
[Win32]::SetForegroundWindow($best.Handle) | Out-Null
try {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate([int]$best.ProcessId)
} catch {}
Start-Sleep -Milliseconds 120
$x = [int]($best.Left + ($best.Width / 2))
$y = [int]($best.Top + $best.Height - 88)
if ($args.Count -gt 0 -and $args[0] -eq 'click') {
  [Win32]::SetCursorPos($x, $y) | Out-Null
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
  [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
Write-Output "$x,$y"
`;

async function focusWindowsCodexWindow(options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await runWindowsPowerShell(WINDOWS_CODEX_WINDOW_SCRIPT, [options.click ? 'click' : 'focus']);
      await delay(CODEX_CLICK_SETTLE_MS);
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError || new Error('No visible Codex window found');
}

async function windowsSendKeys(keys) {
  const filePath = path.join(os.tmpdir(), `codex-sendkeys-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
  fs.writeFileSync(filePath, String(keys || ''), 'utf8');
  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$keys = [System.IO.File]::ReadAllText($args[0], [System.Text.Encoding]::UTF8)
[System.Windows.Forms.SendKeys]::SendWait($keys)
`;
  try {
    await runWindowsPowerShell(script, [filePath]);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

function explainAutomationError(error) {
  const raw = String(error && (error.stderr || error.message) || '');
  if (IS_WINDOWS) {
    return {
      code: 'WINDOWS_AUTOMATION_FAILED',
      message: 'Windows 自动粘贴失败。请确认 Codex Desktop 正在运行，并且服务是在当前已登录桌面会话中启动的。',
      detail: raw,
    };
  }
  const lower = raw.toLowerCase();
  if (lower.includes('assistive') || lower.includes('accessibility') || lower.includes('-25211') || lower.includes('not allowed') || lower.includes('not authorized')) {
    return {
      code: 'ACCESSIBILITY_PERMISSION_REQUIRED',
      message: 'Mac 还没有允许这个终端控制键盘。请到 系统设置 → 隐私与安全性 → 辅助功能，允许 Terminal / Ghostty / Codex 正在使用的终端，然后重启服务再试。',
      detail: raw,
    };
  }
  return {
    code: 'MAC_AUTOMATION_FAILED',
    message: 'Mac 自动粘贴失败。请确认当前有可输入的前台应用，并检查辅助功能权限。',
    detail: raw,
  };
}

function explainTargetError(error, target) {
  const raw = String(error && (error.stderr || error.message) || '');
  if (target === 'codex') {
    return {
      code: 'CODEX_FOCUS_FAILED',
      message: IS_WINDOWS
        ? '已经收到文字，但没能自动聚焦 Codex 输入框。请确认 Windows Codex Desktop 正在运行，并且服务是在当前桌面会话中启动的。'
        : '已经收到文字，但没能自动聚焦 Codex 输入框。请确认 Codex 正在运行，且当前终端已开启辅助功能权限。',
      detail: raw,
    };
  }
  return explainAutomationError(error);
}

async function copyTextToClipboard(text) {
  if (IS_WINDOWS) {
    const filePath = path.join(os.tmpdir(), `codex-clipboard-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
    fs.writeFileSync(filePath, String(text || ''), 'utf8');
    try {
      await runWindowsPowerShell('Set-Clipboard -Value ([System.IO.File]::ReadAllText($args[0], [System.Text.Encoding]::UTF8))', [filePath]);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
    return;
  }

  // pbcopy can silently write to no visible pasteboard when this service runs
  // as a LaunchAgent. AppleScript targets the logged-in user's desktop
  // pasteboard, matching the existing image clipboard path. Use a temp UTF-8
  // file instead of embedding text in the AppleScript command, so Chinese,
  // newlines, quotes and longer messages survive unchanged.
  const filePath = path.join(os.tmpdir(), `codex-clipboard-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
  fs.writeFileSync(filePath, String(text || ''), 'utf8');
  try {
    await runProcess('/usr/bin/osascript', ['-e', `set the clipboard to (read (POSIX file "${appleScriptString(filePath)}") as «class utf8»)`]);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

function getClickTool() {
  for (const candidate of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function toCliclickAbsolutePoint(point) {
  // cliclick treats leading +/- as relative movement. Prefix negative absolute
  // coordinates with '=' for multi-display layouts above/left of the main screen.
  return point.split(',').map(part => part.startsWith('-') ? `=${part}` : part).join(',');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasFreshCodexThreadActivation(threadId) {
  return Boolean(
    isCodexThreadId(threadId) &&
    lastCodexThreadActivation.threadId === threadId &&
    Date.now() - lastCodexThreadActivation.at <= CODEX_THREAD_SYNC_FRESH_MS
  );
}

async function focusTarget(target, threadId = '', options = {}) {
  if (target !== 'codex') return;

  await activateCodexThread(threadId, { allowCached: Boolean(options.assumeThreadSynced) });
  if (options.skipComposerClick) return;

  if (IS_WINDOWS) {
    await focusWindowsCodexWindow({ click: true });
    return;
  }

  const pointTool = path.join(__dirname, 'bin', 'codex-window-point');
  if (!fs.existsSync(pointTool)) throw new Error(`Codex window point helper not found: ${pointTool}`);
  const { stdout } = await runProcess(pointTool, []);
  const point = stdout.trim();
  if (!/^-?\d+,-?\d+$/.test(point)) throw new Error(`Invalid Codex click point: ${point}`);

  const clickTool = getClickTool();
  if (clickTool) {
    await runProcess(clickTool, [`c:${toCliclickAbsolutePoint(point)}`]);
  } else {
    const fallbackClick = `tell application "System Events" to click at {${point}}`;
    await runProcess('osascript', ['-e', fallbackClick]);
  }
  await delay(CODEX_CLICK_SETTLE_MS);
}

async function activateCodexThread(threadId = '', options = {}) {
  if (options.allowCached && hasFreshCodexThreadActivation(threadId)) {
    if (IS_WINDOWS) {
      try { await windowsOpenUri('codex://'); } catch {}
      await focusWindowsCodexWindow({ click: false });
    } else await runProcess('open', ['-b', 'com.openai.codex']);
    await delay(CODEX_APP_FOCUS_SETTLE_MS);
    return;
  }

  const deepLink = codexThreadDeepLink(threadId);
  if (deepLink) {
    if (IS_WINDOWS) await windowsOpenUri(deepLink);
    else await runProcess('open', [deepLink]);
    // Give the Electron router time to replace the visible conversation before
    // we click the composer or paste.
    await delay(CODEX_DEEPLINK_SETTLE_MS);
  }
  if (IS_WINDOWS) {
    if (!deepLink) {
      try {
        await windowsOpenUri('codex://');
        await delay(300);
      } catch {}
    }
    await focusWindowsCodexWindow({ click: false });
  } else await runProcess('open', ['-b', 'com.openai.codex']);
  await delay(CODEX_APP_FOCUS_SETTLE_MS);
  if (isCodexThreadId(threadId)) lastCodexThreadActivation = { threadId, at: Date.now() };
}

async function activateNewCodexThread(cwd = '') {
  const deepLink = codexNewThreadDeepLink(cwd);
  if (IS_WINDOWS) await windowsOpenUri(deepLink);
  else await runProcess('open', [deepLink]);
  await delay(CODEX_DEEPLINK_SETTLE_MS + 180);
  if (IS_WINDOWS) await focusWindowsCodexWindow({ click: false });
  else await runProcess('open', ['-b', 'com.openai.codex']);
  await delay(CODEX_APP_FOCUS_SETTLE_MS);
  lastCodexThreadActivation = { threadId: '', at: 0 };
}

async function activateNewProjectlessCodexThread(anchorThreadId = '') {
  // `codex://threads/new` without a path can inherit Codex Desktop's last
  // active project. To create a real “Chats/对话” thread, first navigate to an
  // existing projectless thread and then invoke Codex's own New Chat command;
  // Codex checks the current thread's project kind and starts with
  // `activeProject: null` for projectless chats.
  if (isCodexThreadId(anchorThreadId)) {
    await activateCodexThread(anchorThreadId);
    await pressCodexShortcut('n', ['command']);
    await delay(CODEX_DEEPLINK_SETTLE_MS + 180);
  } else {
    await activateNewCodexThread('');
  }
  if (IS_WINDOWS) await focusWindowsCodexWindow({ click: false });
  else await runProcess('open', ['-b', 'com.openai.codex']);
  await delay(CODEX_APP_FOCUS_SETTLE_MS);
  lastCodexThreadActivation = { threadId: '', at: 0 };
}

function validLocalDirectory(value) {
  const normalized = value ? path.normalize(value) : '';
  if (!normalized || !path.isAbsolute(normalized)) return '';
  try {
    return fs.statSync(normalized).isDirectory() ? normalized : '';
  } catch {
    return '';
  }
}

function normalizeNewThreadScope(payload = {}) {
  const raw = typeof payload.scope === 'string' ? payload.scope.trim().toLowerCase() : '';
  if (raw === 'conversation' || raw === 'project') return raw;
  if (payload.isProjectThread === false) return 'conversation';
  if (payload.isProjectThread === true) return 'project';
  return '';
}

function projectCwdOrEmpty(value) {
  const cwd = validLocalDirectory(value);
  if (!cwd) return '';
  return classifyThreadProject(cwd).isProjectThread ? cwd : '';
}

function resolveNewThreadTarget(payload = {}) {
  const scope = normalizeNewThreadScope(payload);
  const projectPath = projectCwdOrEmpty(typeof payload.projectPath === 'string' ? payload.projectPath : '');
  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';

  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }

  if (scope === 'conversation') {
    return { scope: 'conversation', cwd: '', anchorThreadId: threadId };
  }

  if (scope === 'project' && projectPath) {
    return { scope: 'project', cwd: projectPath, anchorThreadId: threadId };
  }

  if (threadId) {
    const file = findCodexSessionFileByThreadId(threadId);
    const metaCwd = file ? readSessionMeta(file).cwd || '' : '';
    const metaProject = classifyThreadProject(validLocalDirectory(metaCwd) || '');
    if (metaProject.isProjectThread) {
      return { scope: 'project', cwd: metaProject.projectPath, anchorThreadId: threadId };
    }
    return { scope: 'conversation', cwd: '', anchorThreadId: threadId };
  }

  if (projectPath) return { scope: 'project', cwd: projectPath, anchorThreadId: '' };
  return { scope: 'conversation', cwd: '', anchorThreadId: '' };
}

async function handleNewCodexThread(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  try {
    const target = resolveNewThreadTarget(payload);
    const project = classifyThreadProject(target.cwd);
    if (project.isProjectThread) {
      await activateNewCodexThread(target.cwd);
    } else {
      await activateNewProjectlessCodexThread(target.anchorThreadId);
    }
    return json(res, 200, {
      ok: true,
      pending: true,
      cwd: project.isProjectThread ? target.cwd : '',
      projectName: project.projectName,
      projectPath: project.projectPath,
      projectKey: project.projectKey,
      scope: project.isProjectThread ? 'project' : 'conversation',
      message: project.isProjectThread
        ? `已在 Codex 打开“${project.projectName}”的新线程。`
        : '已在 Codex 打开一个新的对话线程。',
    });
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '新建线程失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

async function handleOpenCodexLink(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  try {
    const link = codexDeepLinkForPayload(payload);
    if (!link) {
      return json(res, 400, { ok: false, code: 'BAD_CODEX_LINK', message: 'Codex 链接不正确。' });
    }
    if (payload.dryRun === true) {
      return json(res, 200, {
        ok: true,
        dryRun: true,
        link,
        message: 'Codex 调用链接校验通过。',
      });
    }
    await openSystemUri(link);
    await delay(CODEX_DEEPLINK_SETTLE_MS);
    if (IS_WINDOWS) await focusWindowsCodexWindow({ click: false });
    return json(res, 200, {
      ok: true,
      link,
      message: '已打开 Codex 调用链接。',
    });
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || 'Codex 链接不支持。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

async function handleSlashCommand(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  if (threadId && !isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    const text = normalizeSlashCommand(payload.command, payload.argument);
    if (payload.dryRun === true) {
      return json(res, 200, {
        ok: true,
        dryRun: true,
        threadId,
        command: text,
        message: 'Slash command 校验通过。',
      });
    }
    await pasteAndEnter(text, 'codex', [], threadId, { assumeThreadSynced: true });
    return json(res, 200, {
      ok: true,
      threadId,
      command: text,
      sentAt: new Date().toISOString(),
      message: '已向 Codex 发送 Slash command。',
    });
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || 'Slash command 发送失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

async function handleCodexAppCommand(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  if (threadId && !isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    const command = normalizeCodexAppCommand(payload.command || payload.action);
    if (payload.dryRun === true) {
      return json(res, 200, {
        ok: true,
        dryRun: true,
        threadId,
        command,
        message: 'Codex App 命令校验通过。',
      });
    }
    const result = await runCodexAppCommand(threadId, command.id);
    return json(res, 200, {
      ok: true,
      threadId,
      command: result,
      sentAt: new Date().toISOString(),
      message: `已执行：${result.label}`,
    });
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || 'Codex App 命令执行失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

function sanitizeFileName(name, fallback = 'image') {
  const base = path.basename(String(name || fallback)).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
  return base || fallback;
}

function extensionForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/heic') return '.heic';
  return '.img';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function decodeAttachment(attachment, index) {
  const mime = String(attachment && attachment.type || '').toLowerCase();
  if (!mime.startsWith('image/')) throw new Error('目前只支持图片附件。');
  const dataUrl = String(attachment.dataUrl || '');
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('图片数据格式不正确。');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`单张图片太大，请控制在 ${formatBytes(MAX_ATTACHMENT_BYTES)} 以内。`);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(attachment.name || '') || extensionForMime(mime);
  const fileName = `${Date.now()}-${index}-${sanitizeFileName(attachment.name || `image${ext}`)}`;
  const filePath = path.join(UPLOAD_DIR, fileName.endsWith(ext) ? fileName : `${fileName}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return { filePath, mime, name: attachment.name || path.basename(filePath), size: buffer.length };
}

function decodeAttachments(input) {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_ATTACHMENTS) throw new Error(`图片最多一次发送 ${MAX_ATTACHMENTS} 张。`);
  return input.map(decodeAttachment);
}

function appleScriptString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function copyImageToClipboard(file) {
  if (IS_WINDOWS) {
    const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($args[0])
try {
  [System.Windows.Forms.Clipboard]::SetImage($image)
} finally {
  $image.Dispose()
}
`;
    await runWindowsPowerShell(script, [file.filePath]);
    return;
  }

  const quoted = appleScriptString(file.filePath);
  let typeExpr = '«class PNGf»';
  if (file.mime === 'image/jpeg') typeExpr = 'JPEG picture';
  else if (file.mime === 'image/gif') typeExpr = 'GIF picture';
  else if (file.mime !== 'image/png') {
    // For less common formats, paste the file reference; many Electron inputs accept it as an attachment.
    await runProcess('osascript', ['-e', `set the clipboard to (POSIX file "${quoted}")`]);
    return;
  }
  await runProcess('osascript', ['-e', `set the clipboard to (read (POSIX file "${quoted}") as ${typeExpr})`]);
}

async function pressPaste() {
  if (IS_WINDOWS) {
    await windowsSendKeys('^v');
    return;
  }

  const script = `
    tell application "System Events"
      keystroke "v" using command down
    end tell
  `;
  await runProcess('osascript', ['-e', script]);
}

async function pressPasteAndEnter() {
  // Keep paste and return as separate automation events. Electron/Codex can
  // accept the pasted text asynchronously; if Return is posted too quickly
  // (especially after iOS dictation commits), the text appears in the composer
  // but the submit key can be swallowed. A short explicit settle plus a fresh
  // System Events command makes the submit step reliable without changing the
  // rest of the send flow.
  await pressPaste();
  await delay(TEXT_PASTE_SETTLE_MS);
  await pressEnter();
}

async function pressPasteAndControlEnter() {
  await pressPaste();
  await delay(TEXT_PASTE_SETTLE_MS);
  await pressControlEnter();
}

async function pressEnter() {
  if (IS_WINDOWS) {
    await windowsSendKeys('{ENTER}');
    return;
  }
  await runProcess('osascript', ['-e', 'tell application "System Events" to key code 36']);
}

async function pressControlEnter() {
  if (IS_WINDOWS) {
    await windowsSendKeys('^{ENTER}');
    return;
  }
  await runProcess('osascript', ['-e', 'tell application "System Events" to key code 36 using control down']);
}

async function pressCodexShortcut(key, modifiers = []) {
  if (IS_WINDOWS) {
    await windowsSendKeys(windowsSendKeysExpression(key, modifiers));
    return;
  }

  const modifierExpr = modifiers.length ? ` using {${modifiers.map(item => `${item} down`).join(', ')}}` : '';
  const script = `
    tell application "System Events"
      keystroke "${appleScriptString(key)}"${modifierExpr}
    end tell
  `;
  await runProcess('osascript', ['-e', script]);
}

async function pressCancelCodexResponse() {
  if (IS_WINDOWS) {
    await windowsSendKeys('{ESC}');
    await delay(80);
    await windowsSendKeys('^.');
    return;
  }

  const script = `
    tell application "System Events"
      key code 53
      delay 0.08
      keystroke "." using command down
    end tell
  `;
  await runProcess('osascript', ['-e', script]);
}


async function pasteAndEnter(text, target = 'frontmost', attachments = [], threadId = '', options = {}) {
  await focusTarget(target, threadId, options);
  const submitMode = options.submitMode === 'guide' ? 'guide' : 'queue';

  for (const attachment of attachments) {
    await copyImageToClipboard(attachment);
    await pressPaste();
    await delay(ATTACHMENT_PASTE_SETTLE_MS);
  }

  if (text) {
    await copyTextToClipboard(text);
    if (submitMode === 'guide') await pressPasteAndControlEnter();
    else await pressPasteAndEnter();
    return;
  }

  if (submitMode === 'guide') await pressControlEnter();
  else await pressEnter();
}

function modelSwitchTargetForCurrent(current = {}, requestedTarget = '') {
  const explicit = String(requestedTarget || '').trim();
  const catalogTarget = findModelOption(explicit);
  if (catalogTarget) return catalogTarget;
  if (!explicit) {
    const options = readModelCatalogOptions();
    if (options.length) return options[0];
  }
  const error = new Error(explicit ? '未找到这个模型。' : '没有读取到可切换的模型。');
  error.status = 400;
  error.code = 'MODEL_TARGET_NOT_FOUND';
  throw error;
}

async function switchCodexGuiModel(threadId = '', targetKey = '') {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }
  const file = threadId ? findCodexSessionFileByThreadId(threadId) : findLatestCodexSessionFile();
  const current = file ? currentModelFromItems(readJsonlTailObjects(file, CODEX_SESSION_TAIL_BYTES)) : modelInfoFromId('');
  const target = modelSwitchTargetForCurrent(current, targetKey);

  await focusTarget('codex', threadId);
  await copyTextToClipboard('/模型');
  await pressPasteAndEnter();
  await delay(CODEX_MODEL_COMMAND_SETTLE_MS);
  await copyTextToClipboard(target.displayName);
  await pressPasteAndEnter();
  await delay(CODEX_COMMAND_SETTLE_MS);

  return {
    ok: true,
    threadId,
    currentModel: current,
    targetModel: { ...target, available: true, updatedAt: new Date().toISOString() },
    message: `已切换到 ${target.displayName}`,
  };
}

function reasoningModeTargetForCurrent(current = {}, requestedTarget = '') {
  const explicit = String(requestedTarget || '').trim();
  if (REASONING_MODE_TARGETS[explicit]) return REASONING_MODE_TARGETS[explicit];
  const order = ['low', 'medium', 'high', 'xhigh'];
  const currentIndex = order.indexOf(current.key);
  const nextKey = order[(currentIndex + 1 + order.length) % order.length] || 'medium';
  return REASONING_MODE_TARGETS[nextKey] || REASONING_MODE_TARGETS.medium;
}

async function switchCodexReasoningMode(threadId = '', targetKey = '') {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }
  const file = threadId ? findCodexSessionFileByThreadId(threadId) : findLatestCodexSessionFile();
  const current = file ? currentReasoningModeFromItems(readJsonlTailObjects(file, CODEX_SESSION_TAIL_BYTES)) : reasoningModeFromValue('');
  const target = reasoningModeTargetForCurrent(current, targetKey);

  await focusTarget('codex', threadId);
  await copyTextToClipboard('/推理模式');
  await pressPasteAndEnter();
  await delay(CODEX_REASONING_COMMAND_SETTLE_MS);
  await copyTextToClipboard(target.displayName);
  await pressPasteAndEnter();
  await delay(CODEX_COMMAND_SETTLE_MS);

  return {
    ok: true,
    threadId,
    currentReasoningMode: current,
    targetReasoningMode: { ...target, available: true, updatedAt: new Date().toISOString() },
    message: `已切换推理模式为 ${target.displayName}`,
  };
}

async function stopCodexResponse(threadId = '') {
  await focusTarget('codex', threadId);
  await pressCancelCodexResponse();
}

function normalizeSlashCommand(command = '', argument = '') {
  const raw = String(command || '').trim();
  if (!raw.startsWith('/')) {
    throw Object.assign(new Error('Slash command 必须以 / 开头。'), { status: 400, code: 'BAD_SLASH_COMMAND' });
  }
  const firstSpace = raw.search(/\s/);
  const base = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
  const inlineArg = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();
  const extraArg = String(argument || '').trim();
  const arg = extraArg || inlineArg;

  if (!CODEX_REMOTE_SAFE_SLASH_COMMANDS.has(base)) {
    throw Object.assign(new Error('这个 Slash command 未开放远控快捷支持。'), { status: 400, code: 'UNSUPPORTED_SLASH_COMMAND' });
  }

  if (base === '/goal') {
    if (!arg) return '/goal';
    const lowerArg = arg.toLowerCase();
    if (['pause', 'resume', 'clear'].includes(lowerArg)) return `/goal ${lowerArg}`;
    if (arg.length > 4000) {
      throw Object.assign(new Error('/goal 内容太长，请控制在 4000 字以内。'), { status: 413, code: 'GOAL_TOO_LONG' });
    }
    return `/goal ${arg}`;
  }

  if (base === '/fast') {
    const lowerArg = arg.toLowerCase();
    if (!['on', 'off', 'status'].includes(lowerArg)) {
      throw Object.assign(new Error('/fast 只支持 on、off 或 status。'), { status: 400, code: 'BAD_FAST_COMMAND' });
    }
    return `/fast ${lowerArg}`;
  }

  if (base === '/plan' || base === '/review') {
    const text = arg ? `${base} ${arg}` : base;
    if (text.length > MAX_TEXT_LENGTH) {
      throw Object.assign(new Error('命令内容太长。'), { status: 413, code: 'SLASH_COMMAND_TOO_LONG' });
    }
    return text;
  }

  if (arg) {
    throw Object.assign(new Error(`${base} 不支持附加参数。`), { status: 400, code: 'BAD_SLASH_COMMAND_ARGUMENT' });
  }
  return base;
}

function normalizeCodexAppCommand(command = '') {
  const raw = String(command || '').trim();
  const compact = raw.replace(/^codex[.:/\\-]+/i, '');
  const direct = [...CODEX_SAFE_APP_COMMANDS.keys()].find(key => key.toLowerCase() === compact.toLowerCase());
  const alias = CODEX_SAFE_APP_COMMAND_ALIASES.get(compact.toLowerCase());
  const commandId = direct || alias || '';
  const definition = commandId ? CODEX_SAFE_APP_COMMANDS.get(commandId) : null;
  if (!definition) {
    throw Object.assign(new Error('这个 Codex App 命令未开放远控快捷支持。'), { status: 400, code: 'UNSUPPORTED_CODEX_APP_COMMAND' });
  }
  return { id: commandId, ...definition };
}

async function runCodexAppCommand(threadId, command) {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }
  const normalized = normalizeCodexAppCommand(command);
  await activateCodexThread(threadId);
  await pressCodexShortcut(normalized.key, normalized.modifiers);
  await delay(CODEX_COMMAND_SETTLE_MS);
  return normalized;
}

async function runCodexThreadCommand(threadId, command, options = {}) {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }
  await activateCodexThread(threadId);

  if (command === 'archive') {
    await pressCodexShortcut('a', ['command', 'shift']);
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { message: '已归档当前 Codex 线程。' };
  }

  if (command === 'pin') {
    await pressCodexShortcut('p', ['command', 'option']);
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { message: options.pinned ? '已置顶当前 Codex 线程。' : '已取消置顶当前 Codex 线程。' };
  }

  if (command === 'rename') {
    const name = String(options.name || '').replace(/\s+/g, ' ').trim();
    if (!name) {
      const error = new Error('新名称不能为空。');
      error.status = 400;
      error.code = 'EMPTY_THREAD_NAME';
      throw error;
    }
    if (name.length > 120) {
      const error = new Error('新名称太长，请控制在 120 个字符以内。');
      error.status = 400;
      error.code = 'THREAD_NAME_TOO_LONG';
      throw error;
    }
    await pressCodexShortcut('r', ['command', 'option']);
    await delay(CODEX_COMMAND_SETTLE_MS);
    await copyTextToClipboard(name);
    await pressPaste();
    await delay(80);
    await pressEnter();
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { message: '已重命名当前 Codex 线程。', name };
  }

  const error = new Error('不支持的线程操作。');
  error.status = 400;
  error.code = 'BAD_THREAD_ACTION';
  throw error;
}

async function handleThreadAction(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const action = String(payload.action || '').trim();
  if (!isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    const state = readCodexState();
    let result;
    if (action === 'archive') {
      result = await runCodexThreadCommand(threadId, 'archive');
      state.archivedThreadIds = setThreadSetMembership(state.archivedThreadIds, threadId, true);
      state.pinnedThreadIds = setThreadSetMembership(state.pinnedThreadIds, threadId, false);
    } else if (action === 'pin' || action === 'unpin') {
      const pinned = action === 'pin';
      result = await runCodexThreadCommand(threadId, 'pin', { pinned });
      state.pinnedThreadIds = setThreadSetMembership(state.pinnedThreadIds, threadId, pinned);
    } else if (action === 'rename') {
      result = await runCodexThreadCommand(threadId, 'rename', { name: payload.name });
      state.titleOverrides = state.titleOverrides || {};
      state.titleOverrides[threadId] = { name: result.name, renamedAt: new Date().toISOString() };
    } else {
      return json(res, 400, { ok: false, code: 'BAD_THREAD_ACTION', message: '不支持的线程操作。' });
    }
    writeCodexState(state);
    const nextThreadId = action === 'archive' ? (listCodexThreads(120)[0]?.id || '') : threadId;
    return json(res, 200, { ok: true, action, threadId, nextThreadId, ...result });
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '线程操作失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

async function handleStopCodex(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  if (threadId && !isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    await stopCodexResponse(threadId);
    return json(res, 200, { ok: true, threadId, message: '已向 Codex 发送终止指令。' });
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

async function handleModelSwitch(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const target = typeof payload.target === 'string' ? payload.target : '';
  try {
    const result = await switchCodexGuiModel(threadId, target);
    return json(res, 200, result);
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '切换模型失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: '没能通过 Codex GUI 切换模型。请确认 Codex 正在运行，且辅助功能权限正常。' });
  }
}

async function handleReasoningMode(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const target = typeof payload.target === 'string' ? payload.target : '';
  try {
    const result = await switchCodexReasoningMode(threadId, target);
    return json(res, 200, result);
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '切换推理模式失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: '没能通过 Codex GUI 切换推理模式。请确认 Codex 正在运行，且辅助功能权限正常。' });
  }
}

async function handleSend(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。请使用启动服务时打印出来的完整控制台链接。' });
  }

  let payload;
  try {
    const body = await readBody(req);
    payload = JSON.parse(body || '{}');
  } catch (error) {
    return json(res, error.status || 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const text = typeof payload.text === 'string' ? payload.text : '';
  const target = payload.target === 'codex' ? 'codex' : 'frontmost';
  const selectedThreadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const assumeThreadSynced = payload.assumeThreadSynced === true;
  const expectNewThread = payload.expectNewThread === true && target === 'codex' && !selectedThreadId;
  const directPasteWithoutClick = payload.directPasteWithoutClick === true && expectNewThread;
  const submitMode = payload.submitMode === 'guide' ? 'guide' : 'queue';
  const previousThreadId = isCodexThreadId(payload.previousThreadId) ? payload.previousThreadId : '';
  const expectedNewThreadCwd = validLocalDirectory(typeof payload.expectedCwd === 'string' ? payload.expectedCwd : '');
  const clientRequestId = normalizeClientRequestId(payload.clientRequestId);
  cleanupRecentSendRequests();
  if (clientRequestId) {
    const existing = recentSendRequests.get(clientRequestId);
    if (existing?.result) return json(res, 200, { ...existing.result, duplicate: true });
    if (existing?.watch) {
      return json(res, 200, {
        ok: true,
        duplicate: true,
        message: '这条发送请求已经被接收，正在继续等待 Codex 回复。',
        target,
        sentAt: existing.sentAt,
        watch: existing.watch,
      });
    }
  }
  let attachments = [];
  try {
    attachments = decodeAttachments(payload.attachments);
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_ATTACHMENT', message: error.message || '图片附件不正确。' });
  }
  if (!text.trim() && !attachments.length) {
    return json(res, 400, { ok: false, code: 'EMPTY_TEXT', message: '请输入文字或添加图片。' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return json(res, 413, { ok: false, code: 'TEXT_TOO_LONG', message: `文字太长了，请控制在 ${MAX_TEXT_LENGTH} 字以内。` });
  }

  try {
    const watchSince = new Date(Date.now() - 750).toISOString();
    const watchSinceMs = Date.parse(watchSince) || Date.now();
    const watchFile = expectNewThread ? null : selectedThreadId ? findCodexSessionFileByThreadId(selectedThreadId) : findLatestCodexSessionFile();
    let watch = target === 'codex' ? {
      since: watchSince,
      threadId: selectedThreadId,
      sessionFile: watchFile ? path.basename(watchFile) : '',
      expectNewThread,
      excludeThreadId: expectNewThread ? previousThreadId : '',
      cwd: expectNewThread ? expectedNewThreadCwd : '',
    } : null;
    if (clientRequestId) {
      recentSendRequests.set(clientRequestId, {
        createdAt: Date.now(),
        sentAt: new Date().toISOString(),
        watch,
      });
    }
    await pasteAndEnter(text, target, attachments, selectedThreadId, { assumeThreadSynced, skipComposerClick: directPasteWithoutClick, submitMode });
    if (expectNewThread && watch) {
      const newSessionFile = await waitForCodexSessionFileForNewSend({
        sinceMs: watchSinceMs,
        text,
        cwd: expectedNewThreadCwd,
        excludeThreadId: previousThreadId,
      });
      if (newSessionFile) {
        watch = {
          ...watch,
          threadId: threadIdFromSessionFile(newSessionFile),
          sessionFile: path.basename(newSessionFile),
          expectNewThread: false,
          excludeThreadId: '',
        };
      }
    }
    const result = {
      ok: true,
      message: target === 'codex'
        ? (submitMode === 'guide' ? '已切到 Codex，并作为引导发送。' : '已切到 Codex，并排队发送。')
        : '已粘贴并按下回车。',
      target,
      submitMode,
      sentAt: new Date().toISOString(),
      attachments: attachments.map(item => ({ name: item.name, size: item.size, type: item.mime })),
      watch,
    };
    if (clientRequestId) {
      recentSendRequests.set(clientRequestId, {
        createdAt: Date.now(),
        sentAt: result.sentAt,
        watch,
        result,
      });
    }
    return json(res, 200, result);
  } catch (error) {
    if (clientRequestId) recentSendRequests.delete(clientRequestId);
    const explained = explainTargetError(error, target);
    return json(res, 500, { ok: false, ...explained });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/control') pathname = '/control.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const staticCacheControl = (() => {
      if (ext === '.html') return 'no-store';
      if (ext === '.webmanifest' || /^favicon\.(?:ico|png)$/i.test(path.basename(filePath)) || relative.startsWith(`icons${path.sep}`)) return 'no-cache';
      return 'public, max-age=3600';
    })();
    const headers = {
      'content-type': mimeTypes[ext] || 'application/octet-stream',
      'cache-control': staticCacheControl,
      'content-length': data.length,
    };
    if (ext === '.html' && url.searchParams.get('token') === TOKEN) {
      headers['set-cookie'] = `codexToken=${encodeURIComponent(TOKEN)}; Path=/; SameSite=Lax; Max-Age=31536000`;
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function getLanApiBases() {
  const nets = os.networkInterfaces();
  const bases = new Set();
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) bases.add(`http://${net.address}:${PORT}`);
    }
  }
  return [...bases];
}

function handleClientConfig(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const isRelay = req.headers['x-codex-relay'] === '1';
  const relayConfigured = relayAgentConfigured();
  return json(res, 200, {
    ok: true,
    service: 'codex',
    appName: APP_NAME,
    localOnly: !isRelay && !relayConfigured,
    relay: isRelay,
    localApiBases: getLanApiBases(),
    relayApiBases: relayConfigured ? [remoteRelayBase()] : [],
    modelOptions: readModelCatalogOptions(),
  });
}

function controlUrlWithToken(baseUrl = '') {
  const url = String(baseUrl || '').replace(/\/+$/, '');
  if (!url) return '';
  return `${url}/control.html?token=${encodeURIComponent(TOKEN)}`;
}

function localEntryUrl(baseUrl = '') {
  const url = String(baseUrl || '').replace(/\/+$/, '');
  return url ? `${url}/` : '';
}

function remoteUrlWithKey(baseUrl = '') {
  const url = String(baseUrl || '').replace(/\/+$/, '');
  if (!url) return '';
  return `${url}/?token=${encodeURIComponent(REMOTE_ACCESS_KEY)}`;
}

function handleControlStatus(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const lanBases = getLanApiBases();
  const relayConfigured = relayAgentConfigured();
  const relayBase = relayConfigured ? remoteRelayBase() : '';
  const primaryLanBase = lanBases[0] || `http://localhost:${PORT}`;
  const exposeSecrets = hasControlToken(req);
  const savedControlConfig = publicControlConfig(readCodexState().controlConfig || {}, { exposeSecrets });
  return json(res, 200, {
    ok: true,
    service: 'codex-control',
    appName: APP_NAME,
    status: 'running',
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    host: HOST,
    hostname: os.hostname(),
    port: PORT,
    uptimeSec: Math.floor(process.uptime()),
    startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
    token: exposeSecrets ? TOKEN : '',
    remoteAccessKey: exposeSecrets ? REMOTE_ACCESS_KEY : '',
    remoteAccessKeyConfigured: Boolean(REMOTE_ACCESS_KEY),
    remoteAccessKeyMasked: redactSecret(REMOTE_ACCESS_KEY),
    localUrl: localEntryUrl(primaryLanBase),
    localControlUrl: exposeSecrets ? controlUrlWithToken(primaryLanBase) : '',
    lanUrls: lanBases.map(localEntryUrl),
    lanControlUrls: exposeSecrets ? lanBases.map(controlUrlWithToken) : [],
    relayConfigured,
    relayConnected: relayConfigured,
    relayUrl: RELAY_URL,
    relayDeviceId: RELAY_DEVICE_ID,
    relayBase,
    remoteUrl: exposeSecrets && relayBase && REMOTE_ACCESS_KEY ? remoteUrlWithKey(relayBase) : '',
    remoteControlUrl: exposeSecrets && relayBase && REMOTE_ACCESS_KEY ? `${relayBase}/control.html?token=${encodeURIComponent(REMOTE_ACCESS_KEY)}` : '',
    settings: {
      port: PORT,
      deviceId: RELAY_DEVICE_ID,
      relayUrl: RELAY_URL,
      remoteKeyMode: 'manual',
      savedControlConfig,
      relayConcurrency: RELAY_AGENT_CONCURRENCY,
      relayPollTimeoutMs: RELAY_POLL_TIMEOUT_MS,
      relayRequestTimeoutMs: RELAY_REQUEST_TIMEOUT_MS,
      stateDir: STATE_DIR,
      publicDir: PUBLIC_DIR,
    },
  });
}

async function handleControlConfig(req, res) {
  if (!hasControlToken(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '控制配置仅限 CodexPanel 桌面控制面板访问。' });
  const state = readCodexState();
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      config: publicControlConfig(state.controlConfig, { exposeSecrets: true }),
      effective: {
        port: PORT,
        relayUrl: RELAY_URL,
        deviceId: RELAY_DEVICE_ID,
        remoteKeyMode: 'manual',
        remoteKey: REMOTE_ACCESS_KEY,
      },
    });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const next = normalizeControlConfig({
    ...payload,
    remoteKeyMode: 'manual',
    remoteKey: payload.remoteKey,
  });
  state.controlConfig = next;
  writeCodexState(state);
  return json(res, 200, {
    ok: true,
    config: publicControlConfig(next, { exposeSecrets: true }),
    effective: {
      port: PORT,
      relayUrl: RELAY_URL,
      deviceId: RELAY_DEVICE_ID,
      remoteKeyMode: 'manual',
      remoteKey: REMOTE_ACCESS_KEY,
    },
    message: '配置已保存。重启本地服务后生效。',
  });
}

function handleHealth(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  return json(res, 200, {
    ok: true,
    service: 'codex',
    host: os.hostname(),
    now: new Date().toISOString(),
  });
}

async function handleAutomationCheck(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const started = Date.now();
  try {
    if (IS_WINDOWS) {
      await focusWindowsCodexWindow({ click: false });
    } else if (IS_MACOS) {
      await runProcess('open', ['-b', 'com.openai.codex']);
    } else {
      return json(res, 200, {
        ok: true,
        service: 'codex-automation-check',
        supported: false,
        platform: process.platform,
        message: '当前平台未启用 Codex Desktop GUI 自动化检查。',
        durationMs: Date.now() - started,
      });
    }
    return json(res, 200, {
      ok: true,
      service: 'codex-automation-check',
      supported: true,
      platform: process.platform,
      focused: true,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, service: 'codex-automation-check', ...explained, durationMs: Date.now() - started });
  }
}

function serviceCheckItem(key, label, fn) {
  const started = Date.now();
  try {
    const result = fn() || {};
    return {
      key,
      label,
      ok: result.ok !== false,
      status: result.status || (result.ok === false ? '异常' : '正常'),
      detail: result.detail || '',
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      key,
      label,
      ok: false,
      status: '异常',
      detail: String(error && error.message || error),
      durationMs: Date.now() - started,
    };
  }
}

function collectServiceChecks() {
  return [
    serviceCheckItem('static', '静态控制台', () => ({
      ok: fs.existsSync(path.join(PUBLIC_DIR, 'control.html')) && fs.existsSync(path.join(PUBLIC_DIR, 'index.html')),
      detail: PUBLIC_DIR,
    })),
    serviceCheckItem('health', '健康检查', () => ({ detail: os.hostname() })),
    serviceCheckItem('config', '客户端配置', () => {
      const modelOptions = readModelCatalogOptions();
      return { detail: `${modelOptions.length} 个模型选项` };
    }),
    serviceCheckItem('control', '控制状态', () => ({
      ok: Boolean(PORT && TOKEN),
      detail: `PID ${process.pid} · ${PORT}`,
    })),
    serviceCheckItem('threads', '线程列表', () => {
      const threads = listCodexThreads(1);
      return { detail: `${threads.length} 条可读线程样本` };
    }),
    serviceCheckItem('codexStatus', 'Codex 状态', () => {
      const status = parseCodexStatus({});
      return { detail: status.active ? '工作中' : '空闲或未检测到活动' };
    }),
    serviceCheckItem('keepAwake', '保持运行', () => {
      const status = keepAwakeStatus();
      return { detail: status.enabled ? '已启用' : '未启用' };
    }),
    serviceCheckItem('relay', 'Relay 远控', () => ({
      ok: true,
      status: relayAgentConfigured() ? '已配置' : '未配置',
      detail: relayAgentConfigured() ? remoteRelayBase() : '仅局域网可用',
    })),
  ];
}

function handleServiceCheck(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const checks = collectServiceChecks();
  const failed = checks.filter(item => !item.ok);
  return json(res, 200, {
    ok: failed.length === 0,
    service: 'codex-service-check',
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
    now: new Date().toISOString(),
  });
}

async function handleKeepAwake(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, ...keepAwakeStatus() });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  try {
    const enabled = payload.enabled === true;
    const status = enabled ? startKeepAwake() : stopKeepAwake();
    return json(res, 200, {
      ok: true,
      ...status,
      message: status.enabled ? '已开启保持亮屏，Mac 不会自动休眠' : '已关闭保持亮屏',
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      code: error.code || 'KEEP_AWAKE_FAILED',
      message: error.message || '切换保持亮屏失败。',
    });
  }
}

function relayAgentConfigured() {
  return Boolean(RELAY_URL && RELAY_DEVICE_ID && REMOTE_ACCESS_KEY);
}

function remoteRelayBase() {
  try {
    const url = new URL(RELAY_URL);
    url.pathname = `/remote/${encodeURIComponent(RELAY_DEVICE_ID)}`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return `${RELAY_URL}/remote/${encodeURIComponent(RELAY_DEVICE_ID)}`.replace(/\/+$/, '');
  }
}

function relayEndpoint(action) {
  return `${RELAY_URL}/agent/${encodeURIComponent(RELAY_DEVICE_ID)}/${action}`;
}

function relayHeaders() {
  return {
    'content-type': 'application/json',
  };
}

function relayDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function relayBackoffMs(failures) {
  const capped = Math.min(6, Math.max(0, failures));
  return Math.min(30000, 1000 * (2 ** capped)) + Math.floor(Math.random() * 350);
}

async function relayFetchJson(url, options = {}, timeoutMs = RELAY_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRelayTaskPath(value) {
  const taskPath = String(value || '/');
  if (!taskPath.startsWith('/') || taskPath.startsWith('//') || /[\r\n]/.test(taskPath)) {
    throw new Error('Relay task path is not safe.');
  }
  return taskPath;
}

function relayLocalUrl(taskPath) {
  return `${RELAY_LOCAL_BASE}${normalizeRelayTaskPath(taskPath)}`;
}

function relayRequestHeaders(input = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(input || {})) {
    const normalized = String(key || '').toLowerCase();
    if (!normalized || RELAY_HOP_BY_HOP_HEADERS.has(normalized)) continue;
    if (normalized.startsWith('cf-')) continue;
    headers[normalized] = String(value);
  }
  headers['x-codex-relay'] = '1';
  headers['x-codex-relay-device'] = RELAY_DEVICE_ID;
  return headers;
}

function relayResponseHeaders(headers) {
  const out = {};
  headers.forEach((value, key) => {
    const normalized = String(key || '').toLowerCase();
    if (!normalized || RELAY_HOP_BY_HOP_HEADERS.has(normalized)) return;
    out[normalized] = value;
  });
  return out;
}

function relayBodyBuffer(bodyBase64 = '') {
  return bodyBase64 ? Buffer.from(String(bodyBase64), 'base64') : null;
}

async function executeRelayTask(task = {}) {
  const requestId = String(task.requestId || '');
  if (!requestId) throw new Error('Relay task is missing requestId.');
  const method = String(task.method || 'GET').toUpperCase();
  const headers = relayRequestHeaders(task.headers);
  const body = ['GET', 'HEAD'].includes(method) ? undefined : relayBodyBuffer(task.bodyBase64);
  const response = await relayFetchJson(relayLocalUrl(task.path), {
    method,
    headers,
    body,
  }, RELAY_REQUEST_TIMEOUT_MS);
  const responseBody = Buffer.from(await response.arrayBuffer());
  return {
    requestId,
    status: response.status,
    headers: relayResponseHeaders(response.headers),
    bodyBase64: responseBody.length ? responseBody.toString('base64') : '',
  };
}

async function postRelayTaskResponse(payload) {
  const response = await relayFetchJson(relayEndpoint('respond'), {
    method: 'POST',
    headers: relayHeaders(),
    body: JSON.stringify(payload),
  }, RELAY_REQUEST_TIMEOUT_MS);
  if (!response.ok && response.status !== 410) {
    const text = await response.text().catch(() => '');
    throw new Error(`Relay response post failed: ${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
  }
}

async function handleRelayTask(task) {
  let payload;
  try {
    payload = await executeRelayTask(task);
  } catch (error) {
    payload = {
      requestId: String(task && task.requestId || ''),
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      bodyBase64: Buffer.from(JSON.stringify({
        ok: false,
        code: 'RELAY_AGENT_ERROR',
        message: error.message || 'Relay agent failed to execute request.',
      })).toString('base64'),
    };
  }
  await postRelayTaskResponse(payload);
}

async function relayAgentLoop(workerIndex = 0) {
  let failures = 0;
  for (;;) {
    try {
      const response = await relayFetchJson(relayEndpoint('poll'), {
        method: 'POST',
        headers: relayHeaders(),
        body: JSON.stringify({
          agent: 'codex',
          deviceId: RELAY_DEVICE_ID,
          workerIndex,
          localBase: RELAY_LOCAL_BASE,
          now: new Date().toISOString(),
        }),
      }, RELAY_POLL_TIMEOUT_MS);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Relay poll failed: ${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
      }

      const task = await response.json();
      failures = 0;
      if (task && task.type === 'request') {
        await handleRelayTask(task);
      } else {
        await relayDelay(120);
      }
    } catch (error) {
      failures += 1;
      console.error(`[relay:${workerIndex}] ${error.message || error}`);
      await relayDelay(relayBackoffMs(failures));
    }
  }
}

function remoteRelayUrl() {
  return `${remoteRelayBase()}/`;
}

function localControlUrls() {
  const urls = new Set([`http://localhost:${PORT}/control.html?token=${TOKEN}`]);
  for (const base of getLanApiBases()) urls.add(controlUrlWithToken(base));
  return [...urls];
}

function redactUrlToken(value = '') {
  try {
    const url = new URL(value);
    if (url.searchParams.has('token')) url.searchParams.set('token', '***');
    return url.toString();
  } catch {
    return String(value || '').replace(/([?&]token=)[^&#]*/g, '$1***');
  }
}

function startRelayAgent() {
  if (!relayAgentConfigured()) return;
  console.log(`Codex relay agent enabled for device "${RELAY_DEVICE_ID}".`);
  console.log(`Remote URL: ${remoteRelayUrl()}`);
  console.log(`Remote access key: ${redactSecret(REMOTE_ACCESS_KEY)}`);
  for (let i = 0; i < RELAY_AGENT_CONCURRENCY; i += 1) {
    relayAgentLoop(i).catch(error => console.error(`[relay:${i}] stopped:`, error));
  }
}

function getLanUrls() {
  const nets = os.networkInterfaces();
  const urls = new Set([`http://localhost:${PORT}/`]);
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.add(`http://${net.address}:${PORT}/`);
      }
    }
  }
  return [...urls];
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  if (req.method === 'GET' && req.url.startsWith('/codex/health')) return handleHealth(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/config')) return handleClientConfig(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/control-status')) return handleControlStatus(req, res);
  if ((req.method === 'GET' || req.method === 'POST') && req.url.startsWith('/codex/control-config')) return handleControlConfig(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/automation-check')) return handleAutomationCheck(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/service-check')) return handleServiceCheck(req, res);
  if (req.method === 'POST' && req.url.startsWith('/send')) return handleSend(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/threads')) return handleThreads(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/history')) return handleThreadHistory(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/status')) return handleCodexStatus(req, res);
  if ((req.method === 'GET' || req.method === 'POST') && req.url.startsWith('/codex/keep-awake')) return handleKeepAwake(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/select')) return handleSelectThread(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/new-thread')) return handleNewCodexThread(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/open-link')) return handleOpenCodexLink(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/slash-command')) return handleSlashCommand(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/app-command')) return handleCodexAppCommand(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/thread-action')) return handleThreadAction(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/model-switch')) return handleModelSwitch(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/reasoning-mode')) return handleReasoningMode(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/stop')) return handleStopCodex(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  const urls = getLanUrls();
  const controlUrls = localControlUrls();
  console.log('\nCodex is running.');
  console.log('Keep this terminal open, then open one of these Web console URLs:');
  for (const url of urls) console.log(`  ${url}`);
  console.log('\nLocal service control panel:');
  for (const url of controlUrls) console.log(`  ${redactUrlToken(url)}`);
  if (relayAgentConfigured()) {
    console.log(`  ${remoteRelayUrl()}`);
    console.log(`  ${redactUrlToken(`${remoteRelayBase()}/control.html?token=${REMOTE_ACCESS_KEY}`)}`);
    console.log(`Remote access key: ${redactSecret(REMOTE_ACCESS_KEY)}`);
  }
  console.log('\nTip: use a LAN URL for local access, or enable the Cloudflare relay for WAN access. Press Ctrl+C to stop.\n');
  if (OPEN_BROWSER_ON_START) {
    setTimeout(() => {
      openSystemUri(urls[0]).catch(error => {
        console.error(`Failed to open browser: ${error.message || error}`);
      });
    }, 350);
  }
  startRelayAgent();
});

process.on('exit', cleanupKeepAwake);
process.on('SIGINT', () => {
  cleanupKeepAwake();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupKeepAwake();
  process.exit(143);
});
