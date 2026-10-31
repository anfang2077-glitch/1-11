#!/usr/bin/env node
/**
 * req-cli - 华为云 CodeArts 需求管理工作项命令行工具。
 *
 * 封装 CreateIssueV4：
 *   POST /v4/projects/{project_id}/issue
 * 鉴权：AK/SK，SDK-HMAC-SHA256。
 *
 * 仅依赖 Node.js >= 18 内置模块，无第三方依赖。
 */

import { createHash, createHmac } from 'node:crypto';
import { realpathSync } from 'node:fs';

const VERSION = '1.0.0';
const REQUEST_TIMEOUT_MS = 30_000;

const EXIT = Object.freeze({
  OK: 0,
  API_ERROR: 1,
  USAGE_ERROR: 2,
  NETWORK_ERROR: 3,
});

const TRACKERS = new Map([
  [2, 'Task'],
  [3, 'Bug'],
  [5, 'Epic'],
  [6, 'Feature'],
  [7, 'Story'],
]);

const PRIORITIES = new Map([
  [1, '低'],
  [2, '中'],
  [3, '高'],
]);

const STATUSES = new Map([
  [1, '新建'],
  [2, '进行中'],
  [3, '已解决'],
  [4, '测试中'],
  [5, '已关闭'],
  [6, '已拒绝'],
]);

const SEVERITIES = new Map([
  [10, '关键'],
  [11, '重要'],
  [12, '一般'],
  [13, '提示'],
]);

const CREATE_VALUE_FLAGS = new Map([
  ['--project-id', 'projectId'],
  ['--tracker', 'tracker'],
  ['--priority', 'priority'],
  ['--description', 'description'],
  ['--status-id', 'statusId'],
  ['--severity', 'severity'],
  ['--assigned-to', 'assignedTo'],
  ['--parent-issue', 'parentIssue'],
  ['--iteration', 'iteration'],
  ['--begin', 'begin'],
  ['--end', 'end'],
]);

class ReqCliError extends Error {
  constructor(message, { exitCode, kind }) {
    super(message);
    this.name = 'ReqCliError';
    this.exitCode = exitCode;
    this.kind = kind;
  }
}

class UsageError extends ReqCliError {
  constructor(message) {
    super(message, { exitCode: EXIT.USAGE_ERROR, kind: 'usage' });
  }
}

class ConfigError extends ReqCliError {
  constructor(message) {
    super(message, { exitCode: EXIT.USAGE_ERROR, kind: 'config' });
  }
}

class ApiError extends ReqCliError {
  constructor(message) {
    super(message, { exitCode: EXIT.API_ERROR, kind: 'api' });
  }
}

class NetworkError extends ReqCliError {
  constructor(message) {
    super(message, { exitCode: EXIT.NETWORK_ERROR, kind: 'network' });
  }
}

function rootHelp() {
  return `req-cli - 华为云 CodeArts 需求管理工作项命令行工具

用法：
  req-cli issue create <title> [选项]
  req-cli issue --help
  req-cli --help
  req-cli --version

命令：
  issue create    创建工作项（CreateIssueV4）

环境变量：
  CODEARTS_REQ_ENDPOINT   必填，CodeArts Req 终端节点，例如
                          https://projectman-ext.cn-north-4.myhuaweicloud.com
  CODEARTS_REQ_AK         必填，访问密钥 AK
  CODEARTS_REQ_SK         必填，访问密钥 SK

示例：
  # 创建一个 Bug
  req-cli issue create "修复登录页面白屏" \\
    --project-id 526cefde62004de2b62b5e8dd2c2b3af \\
    --tracker 3 --priority 3

  # 创建 Task 并以 JSON 输出
  req-cli issue create "编写单元测试" \\
    --project-id 526cefde62004de2b62b5e8dd2c2b3af \\
    --tracker 2 --priority 2 --json

更多帮助：
  req-cli issue create --help
`;
}

function issueHelp() {
  return `req-cli issue - 工作项相关命令

用法：
  req-cli issue create <title> [选项]
  req-cli issue --help

命令：
  create    创建工作项（CreateIssueV4）

说明：
  创建工作项需要配置环境变量 CODEARTS_REQ_ENDPOINT、CODEARTS_REQ_AK、
  CODEARTS_REQ_SK；缺少配置时会直接报错，不会发送请求。

示例：
  req-cli issue create "修复登录页面白屏" \\
    --project-id 526cefde62004de2b62b5e8dd2c2b3af \\
    --tracker 3 --priority 3 --severity 11

查看 create 的完整选项：
  req-cli issue create --help
`;
}

function createHelp() {
  return `req-cli issue create - 创建工作项

用法：
  req-cli issue create <title> [选项]

说明：
  调用华为云 CodeArts 需求管理 CreateIssueV4 接口：
    POST /v4/projects/{project_id}/issue
 使用 AK/SK 签名（SDK-HMAC-SHA256），请求头包含 Authorization 和 X-Sdk-Date。

位置参数：
  <title>                       工作项标题，长度 1~512 个字符

必填选项：
  --project-id <uuid>           项目 ID，32 位 UUID（32 个十六进制字符，
                                允许带标准连字符）
  --tracker <id>                工作项类型：
                                  2 Task / 3 Bug / 5 Epic / 6 Feature / 7 Story
  --priority <id>               优先级：1 低 / 2 中 / 3 高

选填选项：
  --description <text>          工作项描述
  --status-id <id>              状态：1 新建（默认）/ 2 进行中 / 3 已解决 /
                                4 测试中 / 5 已关闭 / 6 已拒绝
  --severity <id>               严重程度：10 关键 / 11 重要 / 12 一般 / 13 提示
  --assigned-to <id>            处理人数字 ID
  --parent-issue <id>           父工作项 ID
  --iteration <id>              迭代 ID
  --begin <yyyy-mm-dd>          开始日期
  --end <yyyy-mm-dd>            结束日期
  --json                        以 JSON 输出 API 响应
  -h, --help                    显示本帮助

示例：
  # 创建一个 Bug（默认状态：新建）
  req-cli issue create "修复登录页面白屏" \\
    --project-id 526cefde62004de2b62b5e8dd2c2b3af \\
    --tracker 3 --priority 3 --severity 11 \\
    --description "用户登录后页面白屏，需要排查"

  # 创建 Task，并以 JSON 输出响应
  req-cli issue create "编写单元测试" \\
    --project-id 526cefde62004de2b62b5e8dd2c2b3af \\
    --tracker 2 --priority 2 --json

  # 创建 Story，指定迭代、处理人和起止日期
  req-cli issue create "用户中心重构" \\
    --project-id 526cefde62004de2b62b5e8dd2c2b3af \\
    --tracker 7 --priority 2 --status-id 2 \\
    --iteration 401 --assigned-to 4091 \\
    --begin 2024-03-01 --end 2024-04-30

退出码：
  0  成功
  1  API 报错（stderr 透传 error_code / error_msg）
  2  参数或配置错误（缺少必填项、非法值、日期格式错误、缺少环境变量）
  3  网络异常

环境变量：
  CODEARTS_REQ_ENDPOINT          CodeArts Req 终端节点（必填）
  CODEARTS_REQ_AK                访问密钥 AK（必填）
  CODEARTS_REQ_SK                访问密钥 SK（必填）
`;
}

/**
 * 解析 create 子命令参数。遇到 --help 时提前返回，以便不依赖环境变量即可查看帮助。
 * 注意：缺少 title 由后续统一校验处理，便于一次输出所有参数错误。
 */
export function parseCreateArgs(args) {
  const options = { json: false };
  const positionals = [];
  let optionsEnded = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (optionsEnded) {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      optionsEnded = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      return { help: true };
    }

    if (token === '--json') {
      options.json = true;
      continue;
    }

    if (token.startsWith('--json=')) {
      const value = token.slice('--json='.length);
      if (value === 'true') {
        options.json = true;
        continue;
      }
      if (value === 'false') {
        options.json = false;
        continue;
      }
      throw new UsageError('--json 只接受 true 或 false，或直接使用 --json');
    }

    if (token.startsWith('--')) {
      const equalsIndex = token.indexOf('=');
      const flagName = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
      const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
      const key = CREATE_VALUE_FLAGS.get(flagName);

      if (!key) {
        throw new UsageError(`未知选项：${flagName}`);
      }

      if (inlineValue !== undefined) {
        options[key] = inlineValue;
        continue;
      }

      const next = args[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) {
        throw new UsageError(`选项 ${flagName} 缺少值`);
      }

      options[key] = next;
      i += 1;
      continue;
    }

    if (token.startsWith('-') && token !== '-') {
      throw new UsageError(`未知选项：${token}`);
    }

    positionals.push(token);
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `标题之后存在多余参数：${positionals.slice(1).join(' ')}（标题包含空格时请使用引号）`,
    );
  }

  options.title = positionals[0];
  return { help: false, options };
}

function parseIntegerValue(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function isValidProjectId(value) {
  return /^[0-9a-fA-F]{32}$/.test(value)
    || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/**
 * 校验 create 参数并收集全部错误，返回归一化后的输入。
 */
export function validateCreateOptions(rawOptions) {
  const errors = [];
  const input = {
    title: undefined,
    projectId: undefined,
    tracker: undefined,
    priority: undefined,
    statusId: 1,
    severity: undefined,
    assignedTo: undefined,
    parentIssue: undefined,
    iteration: undefined,
    begin: undefined,
    end: undefined,
    description: rawOptions.description,
    json: Boolean(rawOptions.json),
  };

  const rawTitle = rawOptions.title;
  if (rawTitle === undefined || rawTitle === null || rawTitle === '') {
    errors.push('缺少必填参数：工作项标题 <title>');
  } else {
    const length = Array.from(String(rawTitle)).length;
    if (length < 1 || length > 512) {
      errors.push(`标题长度必须在 1~512 个字符之间（当前为 ${length} 个字符）`);
    } else {
      input.title = String(rawTitle);
    }
  }

  if (rawOptions.projectId === undefined) {
    errors.push('缺少必填参数：--project-id（项目 32 位 UUID）');
  } else {
    const projectId = String(rawOptions.projectId).trim();
    if (!isValidProjectId(projectId)) {
      errors.push('--project-id 格式不正确，应为 32 位 UUID（32 个十六进制字符，可带标准连字符）');
    } else {
      input.projectId = projectId;
    }
  }

  const trackerRule = '2 Task / 3 Bug / 5 Epic / 6 Feature / 7 Story';
  if (rawOptions.tracker === undefined) {
    errors.push(`缺少必填参数：--tracker（${trackerRule}）`);
  } else {
    const tracker = parseIntegerValue(rawOptions.tracker);
    if (tracker === null || !TRACKERS.has(tracker)) {
      errors.push(`--tracker 非法，允许值：${trackerRule}`);
    } else {
      input.tracker = tracker;
    }
  }

  const priorityRule = '1 低 / 2 中 / 3 高';
  if (rawOptions.priority === undefined) {
    errors.push(`缺少必填参数：--priority（${priorityRule}）`);
  } else {
    const priority = parseIntegerValue(rawOptions.priority);
    if (priority === null || !PRIORITIES.has(priority)) {
      errors.push(`--priority 非法，允许值：${priorityRule}`);
    } else {
      input.priority = priority;
    }
  }

  if (rawOptions.statusId !== undefined) {
    const statusId = parseIntegerValue(rawOptions.statusId);
    if (statusId === null || !STATUSES.has(statusId)) {
      errors.push('--status-id 非法，允许值：1 新建 / 2 进行中 / 3 已解决 / 4 测试中 / 5 已关闭 / 6 已拒绝');
    } else {
      input.statusId = statusId;
    }
  }

  if (rawOptions.severity !== undefined) {
    const severity = parseIntegerValue(rawOptions.severity);
    if (severity === null || !SEVERITIES.has(severity)) {
      errors.push('--severity 非法，允许值：10 关键 / 11 重要 / 12 一般 / 13 提示');
    } else {
      input.severity = severity;
    }
  }

  for (const [key, flagName] of [
    ['assignedTo', '--assigned-to'],
    ['parentIssue', '--parent-issue'],
    ['iteration', '--iteration'],
  ]) {
    if (rawOptions[key] === undefined) continue;
    const value = parseIntegerValue(rawOptions[key]);
    if (value === null || value < 0) {
      errors.push(`${flagName} 应为非负整数 ID`);
    } else {
      input[key] = value;
    }
  }

  for (const [key, flagName] of [
    ['begin', '--begin'],
    ['end', '--end'],
  ]) {
    if (rawOptions[key] === undefined) continue;
    if (!isValidDate(rawOptions[key])) {
      errors.push(`${flagName} 日期格式不正确或日期不存在，应为有效的 yyyy-mm-dd（例如 2024-03-01）`);
    } else {
      input[key] = rawOptions[key];
    }
  }

  return { errors, input };
}

/**
 * 校验并归一化 create 参数；存在错误时抛出包含全部错误的 UsageError。
 */
export function buildCreateInput(rawOptions) {
  const { errors, input } = validateCreateOptions(rawOptions);
  if (errors.length > 0) {
    throw new UsageError(errors.join('\n'));
  }
  return input;
}

/**
 * 构造 CreateIssueV4 请求体。字段名对应华为云 API。
 */
export function buildIssuePayload(input) {
  const payload = {
    name: input.title,
    tracker_id: input.tracker,
    priority_id: input.priority,
    status_id: input.statusId,
  };

  if (input.description !== undefined) {
    payload.description = input.description;
  }
  if (input.severity !== undefined) {
    payload.severity_id = input.severity;
  }
  if (input.assignedTo !== undefined) {
    payload.assigned_to = input.assignedTo;
  }
  if (input.parentIssue !== undefined) {
    payload.parent_issue_id = input.parentIssue;
  }
  if (input.iteration !== undefined) {
    payload.iteration_id = input.iteration;
  }
  if (input.begin !== undefined) {
    payload.begin_time = input.begin;
  }
  if (input.end !== undefined) {
    payload.end_time = input.end;
  }

  return payload;
}

/**
 * 读取并校验环境变量。缺少任何必填配置时抛错，调用方不会发送请求。
 */
export function loadConfig(env = process.env) {
  const endpointValue = typeof env.CODEARTS_REQ_ENDPOINT === 'string'
    ? env.CODEARTS_REQ_ENDPOINT.trim()
    : '';
  const akValue = typeof env.CODEARTS_REQ_AK === 'string' ? env.CODEARTS_REQ_AK : '';
  const skValue = typeof env.CODEARTS_REQ_SK === 'string' ? env.CODEARTS_REQ_SK : '';

  const missing = [];
  if (!endpointValue) missing.push('CODEARTS_REQ_ENDPOINT');
  if (!akValue.trim()) missing.push('CODEARTS_REQ_AK');
  if (!skValue.trim()) missing.push('CODEARTS_REQ_SK');

  if (missing.length > 0) {
    throw new ConfigError(
      `缺少环境变量 ${missing.join('、')}。请先配置后再执行（本次未发送任何请求）`,
    );
  }

  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new ConfigError(
      'CODEARTS_REQ_ENDPOINT 不是合法的 URL，请包含协议和主机，例如 https://projectman-ext.cn-north-4.myhuaweicloud.com',
    );
  }

  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new ConfigError('CODEARTS_REQ_ENDPOINT 仅支持 http:// 或 https:// 协议');
  }
  if (endpoint.username || endpoint.password) {
    throw new ConfigError('CODEARTS_REQ_ENDPOINT 不能包含用户名或密码');
  }

  endpoint.search = '';
  endpoint.hash = '';

  return { endpoint, ak: akValue, sk: skValue };
}

export function buildApiUrl(endpoint, projectId) {
  const url = endpoint instanceof URL ? new URL(endpoint.href) : new URL(endpoint);
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/v4/projects/${projectId}/issue`;
  url.search = '';
  url.hash = '';
  return url;
}

export function formatSdkDate(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function rfc3986Encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function canonicalUri(pathname) {
  let segments;
  try {
    segments = pathname.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    segments = pathname.split('/');
  }

  let uri = segments.map(rfc3986Encode).join('/');
  if (!uri.startsWith('/')) uri = `/${uri}`;
  if (!uri.endsWith('/')) uri = `${uri}/`;
  return uri;
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacSha256Hex(secret, value) {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

/**
 * 生成华为云 SDK-HMAC-SHA256 签名。
 *
 * 参与签名的请求头为 host、x-sdk-date；content-type 仍会随请求发送。
 * CanonicalURI 按华为云签名规范以 "/" 结尾。
 */
export function signRequest({
  method = 'POST',
  url,
  body,
  ak,
  sk,
  now = new Date(),
}) {
  const target = url instanceof URL ? url : new URL(url);
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const sdkDate = formatSdkDate(now);

  const headerValues = {
    host: target.host,
    'x-sdk-date': sdkDate,
  };
  const signedHeaderNames = Object.keys(headerValues).sort();
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalHeaders = `${signedHeaderNames
    .map((name) => `${name}:${headerValues[name].trim()}`)
    .join('\n')}\n`;

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(target.pathname),
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');

  const stringToSign = [
    'SDK-HMAC-SHA256',
    sdkDate,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmacSha256Hex(sk, stringToSign);
  const authorization =
    `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    payload,
    sdkDate,
    canonicalRequest,
    stringToSign,
    authorization,
    headers: {
      'Content-Type': 'application/json',
      'X-Sdk-Date': sdkDate,
      Authorization: authorization,
    },
  };
}

function describeFetchError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return '请求超时';
  }

  const cause = error?.cause;
  if (cause?.code) return `${cause.code}${cause.message ? `：${cause.message}` : ''}`;
  if (cause?.message) return cause.message;
  return error?.message || String(error);
}

function parseApiError(status, data, bodyText) {
  let errorCode;
  let errorMsg;

  if (data && typeof data === 'object') {
    errorCode = data.error_code ?? data.error?.code ?? data.code;
    errorMsg = data.error_msg ?? data.error?.message ?? data.message;
  }

  if (errorCode === undefined) errorCode = `HTTP_${status}`;
  if (errorMsg === undefined || errorMsg === '') {
    errorMsg = typeof bodyText === 'string' && bodyText.trim()
      ? bodyText.trim()
      : `HTTP ${status}`;
  }

  return { errorCode: String(errorCode), errorMsg: String(errorMsg) };
}

/**
 * 调用 CreateIssueV4。
 *
 * options.fetchImpl 可注入测试用 fetch；生产环境使用 Node.js 内置 fetch。
 */
export async function createIssue(config, input, { fetchImpl = globalThis.fetch } = {}) {
  const payload = buildIssuePayload(input);
  const body = JSON.stringify(payload);
  const url = buildApiUrl(config.endpoint, input.projectId);
  const urlString = url.toString();
  const signed = signRequest({
    method: 'POST',
    url,
    body,
    ak: config.ak,
    sk: config.sk,
  });

  let response;
  try {
    response = await fetchImpl(urlString, {
      method: 'POST',
      headers: signed.headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new NetworkError(
      `请求 ${url.origin} 失败：${describeFetchError(error)}`,
    );
  }

  let data;
  let responseText = '';
  try {
    if (typeof response.text === 'function') {
      responseText = await response.text();
      if (typeof responseText === 'string' && responseText.trim() !== '') {
        try {
          data = JSON.parse(responseText);
        } catch {
          data = undefined;
        }
      }
    } else if (typeof response.json === 'function') {
      data = await response.json();
      if (data !== undefined) responseText = JSON.stringify(data);
    }
  } catch (error) {
    throw new NetworkError(
      `读取 ${url.origin} 的响应失败：${describeFetchError(error)}`,
    );
  }

  if (response.ok === false) {
    const { errorCode, errorMsg } = parseApiError(response.status, data, responseText);
    throw new ApiError(
      `HTTP ${response.status}，error_code=${errorCode}，error_msg=${errorMsg}`,
    );
  }

  if (data === undefined) {
    throw new ApiError(
      `HTTP ${response.status} 的响应不是有效 JSON，无法解析工作项信息`,
    );
  }

  if (data === null || typeof data !== 'object') {
    throw new ApiError(`HTTP ${response.status} 的响应格式不符合预期`);
  }

  return { data, payload, url, signed };
}

function labelWithName(id, names) {
  const number = Number(id);
  if (Number.isSafeInteger(number)) {
    const name = names.get(number);
    return name ? `${number} (${name})` : String(number);
  }
  return id === undefined || id === null ? '-' : String(id);
}

function printSummary(data, input, writeOut) {
  const id = data.id ?? '-';
  const name = data.name ?? input.title;
  const tracker = data.tracker ?? {};
  const priority = data.priority ?? {};
  const status = data.status ?? {};

  const trackerId = tracker.id ?? input.tracker;
  const priorityId = priority.id ?? input.priority;
  const statusId = status.id ?? input.statusId;

  const trackerText = tracker.name
    ? `${trackerId} (${tracker.name})`
    : labelWithName(trackerId, TRACKERS);
  const priorityText = priority.name
    ? `${priorityId} (${priority.name})`
    : labelWithName(priorityId, PRIORITIES);
  const statusText = status.name
    ? `${statusId} (${status.name})`
    : labelWithName(statusId, STATUSES);

  const severity = data.severity ?? {};
  const severityId = severity.id ?? input.severity;
  const severityText = severity.name
    ? `${severityId} (${severity.name})`
    : labelWithName(severityId, SEVERITIES);

  const lines = [
    '工作项创建成功',
    `  ID:       ${id}`,
    `  标题:      ${name}`,
    `  类型:      ${trackerText}`,
    `  优先级:    ${priorityText}`,
    `  状态:      ${statusText}`,
  ];
  if (severityId !== undefined) {
    lines.push(`  严重程度:  ${severityText}`);
  }

  writeOut(lines.join('\n'));
}

function errorPrefix(kind) {
  return {
    usage: '参数错误',
    config: '配置错误',
    api: 'API 错误',
    network: '网络异常',
  }[kind] ?? '错误';
}

function reportError(writeErr, error) {
  if (error instanceof ReqCliError) {
    writeErr(`${errorPrefix(error.kind)}：${error.message}`);
    if (error.kind === 'usage') {
      writeErr('提示：运行 "req-cli issue create --help" 查看用法。');
    }
    return error.exitCode;
  }

  writeErr(`错误：${error?.message ?? String(error)}`);
  return EXIT.API_ERROR;
}

/**
 * 执行一次 CLI 调用并返回退出码。可注入输出流与 fetch，便于测试。
 *
 * @param {string[]} argv
 * @param {Record<string, string|undefined>} env
 * @param {{stdout?: {write: Function}, stderr?: {write: Function}, fetchFn?: Function}} options
 * @returns {Promise<number>}
 */
export async function run(argv, env = process.env, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const fetchFn = options.fetchFn ?? options.fetchImpl ?? globalThis.fetch;

  const writeOut = (text) => {
    const value = String(text);
    stdout.write(value.endsWith('\n') ? value : `${value}\n`);
  };
  const writeErr = (text) => {
    const value = String(text);
    stderr.write(value.endsWith('\n') ? value : `${value}\n`);
  };

  try {
    if (argv.length === 0) {
      writeOut(rootHelp());
      return EXIT.OK;
    }

    const first = argv[0];

    if (first === '--help' || first === '-h') {
      writeOut(rootHelp());
      return EXIT.OK;
    }

    if (first === '--version' || first === '-v') {
      writeOut(`req-cli ${VERSION}`);
      return EXIT.OK;
    }

    if (first === 'help') {
      if (argv.length === 1) {
        writeOut(rootHelp());
        return EXIT.OK;
      }
      if (argv[1] === 'issue') {
        if (argv[2] === 'create') {
          writeOut(createHelp());
        } else if (argv.length === 2) {
          writeOut(issueHelp());
        } else {
          throw new UsageError(`未知命令：help ${argv.slice(1).join(' ')}`);
        }
        return EXIT.OK;
      }
      throw new UsageError(`未知命令：help ${argv.slice(1).join(' ')}`);
    }

    if (first !== 'issue') {
      throw new UsageError(`未知命令：${first}`);
    }

    if (argv.length === 1 || argv[1] === '--help' || argv[1] === '-h') {
      writeOut(issueHelp());
      return EXIT.OK;
    }

    if (argv[1] !== 'create') {
      throw new UsageError(`未知子命令：issue ${argv[1]}`);
    }

    const parsed = parseCreateArgs(argv.slice(2));
    if (parsed.help) {
      writeOut(createHelp());
      return EXIT.OK;
    }

    const { errors, input } = validateCreateOptions(parsed.options);
    if (errors.length > 0) {
      writeErr('参数错误：');
      for (const error of errors) writeErr(`  - ${error}`);
      writeErr('提示：运行 "req-cli issue create --help" 查看用法。');
      return EXIT.USAGE_ERROR;
    }

    const config = loadConfig(env);
    const { data } = await createIssue(config, input, { fetchImpl: fetchFn });

    if (input.json) {
      writeOut(JSON.stringify(data, null, 2));
    } else {
      printSummary(data, input, writeOut);
    }

    return EXIT.OK;
  } catch (error) {
    return reportError(writeErr, error);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run(process.argv.slice(2), process.env, {
    stdout: process.stdout,
    stderr: process.stderr,
  }).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`错误：${error?.message ?? String(error)}\n`);
    process.exitCode = EXIT.API_ERROR;
  });
}

export {
  EXIT,
  TRACKERS,
  PRIORITIES,
  STATUSES,
  SEVERITIES,
  rootHelp,
  issueHelp,
  createHelp,
};
