import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from '../req-cli.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, '..');
const CLI = path.join(ROOT, 'req-cli.mjs');

const PROJECT_ID = '526cefde62004de2b62b5e8dd2c2b3af';
const AK = 'test-ak';
const SK = 'test-sk';

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CODEARTS_REQ_')) delete env[key];
  }
  return { ...env, NO_COLOR: '1', ...extra };
}

function runCli(args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: cleanEnv(env),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 15_000);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function startMockServer(handler) {
  const requests = [];

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const record = { method: req.method, url: req.url, headers: req.headers, body };
    requests.push(record);

    try {
      await handler(req, res, record);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`mock handler error: ${error.message}`);
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function issueFixture(overrides = {}) {
  return {
    id: 1377843,
    name: '修复登录页面白屏',
    done_ratio: 0,
    tracker: { id: 3, name: 'Bug' },
    priority: { id: 3, name: '高' },
    severity: { id: 11, name: '重要' },
    status: { id: 1, name: '新建' },
    assigned_user: { id: 4091, name: 'tester' },
    ...overrides,
  };
}

function jsonResponse(status, data) {
  return (req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// 用独立实现重算华为云 SDK-HMAC-SHA256，验证 CLI 的签名细节。
function expectedAuthorization({ pathName, headers, body }) {
  const sdkDate = headers['x-sdk-date'];
  const canonicalHeaders =
    `host:${headers.host}\n` +
    `x-sdk-date:${sdkDate}\n`;
  const uri = pathName.endsWith('/') ? pathName : `${pathName}/`;
  const signedHeaders = 'host;x-sdk-date';
  const canonicalRequest = [
    'POST',
    uri,
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(body),
  ].join('\n');
  const stringToSign = `SDK-HMAC-SHA256\n${sdkDate}\n${sha256(canonicalRequest)}`;
  const signature = createHmac('sha256', SK).update(stringToSign, 'utf8').digest('hex');
  return `SDK-HMAC-SHA256 Access=${AK}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

const validArgs = [
  'issue', 'create', '修复登录页面白屏',
  '--project-id', PROJECT_ID,
  '--tracker', '3',
  '--priority', '3',
];

test('根命令、issue、issue create 的 --help 均可离线使用', async () => {
  const root = await runCli(['--help']);
  assert.equal(root.code, 0);
  assert.match(root.stdout, /用法/);
  assert.match(root.stdout, /CODEARTS_REQ_ENDPOINT/);
  assert.match(root.stdout, /示例/);

  const issue = await runCli(['issue', '--help']);
  assert.equal(issue.code, 0);
  assert.match(issue.stdout, /req-cli issue create/);
  assert.match(issue.stdout, /--help/);

  const create = await runCli(['issue', 'create', '--help']);
  assert.equal(create.code, 0);
  for (const flag of [
    '--project-id', '--tracker', '--priority', '--description', '--status-id',
    '--severity', '--assigned-to', '--parent-issue', '--iteration',
    '--begin', '--end', '--json',
  ]) {
    assert.ok(create.stdout.includes(flag), `help 应包含 ${flag}`);
  }
  assert.match(create.stdout, /示例/);

  const helpCommand = await runCli(['help', 'issue', 'create']);
  assert.equal(helpCommand.code, 0);
  assert.match(helpCommand.stdout, /创建工作项/);
});

test('无参数时输出根帮助，--version 输出版本', async () => {
  const noArgs = await runCli([]);
  assert.equal(noArgs.code, 0);
  assert.match(noArgs.stdout, /req-cli issue create/);

  const version = await runCli(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^req-cli \d+\.\d+\.\d+\n$/);
});

test('缺少环境变量时退出码 2，且不会发送请求', async (t) => {
  const server = await startMockServer(jsonResponse(200, issueFixture()));
  t.after(() => server.close());

  const missingAll = await runCli(validArgs);
  assert.equal(missingAll.code, 2);
  assert.match(missingAll.stderr, /配置错误/);
  assert.match(missingAll.stderr, /CODEARTS_REQ_ENDPOINT/);
  assert.match(missingAll.stderr, /CODEARTS_REQ_AK/);
  assert.match(missingAll.stderr, /CODEARTS_REQ_SK/);
  assert.equal(missingAll.stdout, '');

  const missingSk = await runCli(validArgs, {
    env: {
      CODEARTS_REQ_ENDPOINT: server.url,
      CODEARTS_REQ_AK: AK,
    },
  });
  assert.equal(missingSk.code, 2);
  assert.match(missingSk.stderr, /CODEARTS_REQ_SK/);

  assert.equal(server.requests.length, 0, '缺配置时不应发出 HTTP 请求');
});

test('非法终端节点退出码 2 且不发请求', async () => {
  const invalid = await runCli(validArgs, {
    env: {
      CODEARTS_REQ_ENDPOINT: 'not-a-url',
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /CODEARTS_REQ_ENDPOINT/);
  assert.match(invalid.stderr, /URL/);
});

test('参数校验失败时退出码 2，给出中文提示且不发请求', async (t) => {
  const server = await startMockServer(jsonResponse(200, issueFixture()));
  t.after(() => server.close());

  const env = {
    CODEARTS_REQ_ENDPOINT: server.url,
    CODEARTS_REQ_AK: AK,
    CODEARTS_REQ_SK: SK,
  };

  const cases = [
    { name: '缺少标题', args: ['issue', 'create', '--project-id', PROJECT_ID, '--tracker', '3', '--priority', '3'], match: /缺少必填参数：工作项标题/ },
    { name: '缺少 project-id', args: ['issue', 'create', '标题', '--tracker', '3', '--priority', '3'], match: /--project-id/ },
    { name: '缺少 tracker', args: ['issue', 'create', '标题', '--project-id', PROJECT_ID, '--priority', '3'], match: /--tracker/ },
    { name: '缺少 priority', args: ['issue', 'create', '标题', '--project-id', PROJECT_ID, '--tracker', '3'], match: /--priority/ },
    { name: 'project-id 非 UUID', args: ['issue', 'create', '标题', '--project-id', 'abc', '--tracker', '3', '--priority', '3'], match: /32 位 UUID/ },
    { name: 'tracker 非法', args: ['issue', 'create', '标题', '--project-id', PROJECT_ID, '--tracker', '4', '--priority', '3'], match: /--tracker/ },
    { name: 'priority 非法', args: ['issue', 'create', '标题', '--project-id', PROJECT_ID, '--tracker', '3', '--priority', '0'], match: /--priority/ },
    { name: 'status-id 非法', args: [...validArgs, '--status-id', '7'], match: /--status-id/ },
    { name: 'severity 非法', args: [...validArgs, '--severity', '9'], match: /--severity/ },
    { name: 'assigned-to 非数字', args: [...validArgs, '--assigned-to', 'abc'], match: /--assigned-to/ },
    { name: '日期格式错误', args: [...validArgs, '--begin', '2024/03/01'], match: /yyyy-mm-dd/ },
    { name: '日期不存在', args: [...validArgs, '--end', '2023-02-29'], match: /日期格式不正确或日期不存在/ },
    { name: '未知选项', args: [...validArgs, '--unknown', 'x'], match: /未知选项/ },
    { name: '多余位置参数', args: ['issue', 'create', '标题', '多余', '--project-id', PROJECT_ID, '--tracker', '3', '--priority', '3'], match: /多余参数/ },
    { name: '选项缺值', args: ['issue', 'create', '标题', '--project-id', '--tracker', '3', '--priority', '3'], match: /缺少值/ },
    { name: '标题超过 512 字符', args: ['issue', 'create', 'a'.repeat(513), '--project-id', PROJECT_ID, '--tracker', '3', '--priority', '3'], match: /1~512/ },
  ];

  for (const item of cases) {
    const result = await runCli(item.args, { env });
    assert.equal(result.code, 2, `${item.name} 应返回 2，实际 ${result.code}：${result.stderr}`);
    assert.match(result.stderr, /参数错误/, `${item.name} 应输出中文参数错误`);
    assert.match(result.stderr, item.match, `${item.name} 的提示不匹配`);
    assert.equal(result.stdout, '', `${item.name} 不应输出到 stdout`);
  }

  assert.equal(server.requests.length, 0, '参数错误时不应发出 HTTP 请求');
});

test('成功创建：请求路径、请求体、请求头与签名正确，默认输出摘要', async (t) => {
  const fixture = issueFixture();
  const server = await startMockServer(jsonResponse(200, fixture));
  t.after(() => server.close());

  const result = await runCli(validArgs, {
    env: {
      CODEARTS_REQ_ENDPOINT: server.url,
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /工作项创建成功/);
  assert.match(result.stdout, /1377843/);
  assert.match(result.stdout, /修复登录页面白屏/);
  assert.match(result.stdout, /3 \(Bug\)/);
  assert.match(result.stdout, /3 \(高\)/);
  assert.match(result.stdout, /1 \(新建\)/);

  assert.equal(server.requests.length, 1);
  const request = server.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `/v4/projects/${PROJECT_ID}/issue`);
  assert.equal(request.headers['content-type'], 'application/json');
  assert.match(request.headers['x-sdk-date'], /^\d{8}T\d{6}Z$/);
  assert.equal(request.headers['x-auth-token'], undefined, 'AK/SK 鉴权不应发送 X-Auth-Token');

  assert.deepEqual(JSON.parse(request.body), {
    name: '修复登录页面白屏',
    tracker_id: 3,
    priority_id: 3,
    status_id: 1,
  });

  assert.equal(
    request.headers.authorization,
    expectedAuthorization({
      pathName: request.url,
      headers: request.headers,
      body: request.body,
    }),
  );
});

test('选填参数全部正确映射到 API 字段，并支持 --json', async (t) => {
  const fixture = issueFixture({
    name: '用户中心重构',
    tracker: { id: 7, name: 'Story' },
    priority: { id: 2, name: '中' },
    status: { id: 2, name: '进行中' },
  });
  const server = await startMockServer(jsonResponse(200, fixture));
  t.after(() => server.close());

  const result = await runCli([
    'issue', 'create', '用户中心重构',
    '--project-id', PROJECT_ID,
    '--tracker', '7',
    '--priority', '2',
    '--description', '包含个人资料与偏好设置',
    '--status-id', '2',
    '--severity', '11',
    '--assigned-to', '4091',
    '--parent-issue', '1679822',
    '--iteration', '11302238',
    '--begin', '2024-03-01',
    '--end', '2024-04-30',
    '--json',
  ], {
    env: {
      CODEARTS_REQ_ENDPOINT: server.url,
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), fixture);
  assert.equal(result.stdout.includes('工作项创建成功'), false, '--json 时不应混入摘要文本');

  assert.equal(server.requests.length, 1);
  assert.deepEqual(JSON.parse(server.requests[0].body), {
    name: '用户中心重构',
    tracker_id: 7,
    priority_id: 2,
    status_id: 2,
    description: '包含个人资料与偏好设置',
    severity_id: 11,
    assigned_to: 4091,
    parent_issue_id: 1679822,
    iteration_id: 11302238,
    begin_time: '2024-03-01',
    end_time: '2024-04-30',
  });
});

test('支持 512 字符标题，--json 输出完整响应', async (t) => {
  const title = 'a'.repeat(512);
  const fixture = issueFixture({ name: title, tracker: { id: 2, name: 'Task' } });
  const server = await startMockServer(jsonResponse(200, fixture));
  t.after(() => server.close());

  const result = await runCli([
    'issue', 'create', title,
    '--project-id', PROJECT_ID,
    '--tracker', '2',
    '--priority', '1',
    '--json',
  ], {
    env: {
      CODEARTS_REQ_ENDPOINT: server.url,
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).name, title);
  assert.equal(JSON.parse(server.requests[0].body).name, title);
});

test('API 报错时退出码 1，并透传 error_code / error_msg', async (t) => {
  const server = await startMockServer(jsonResponse(400, {
    error_code: 'APIGW.0301',
    error_msg: 'Incorrect IAM authentication information: verify aksk signature fail',
  }));
  t.after(() => server.close());

  const result = await runCli(validArgs, {
    env: {
      CODEARTS_REQ_ENDPOINT: server.url,
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /API 错误/);
  assert.match(result.stderr, /APIGW\.0301/);
  assert.match(result.stderr, /Incorrect IAM authentication information/);
});

test('网络异常时退出码 3', async (t) => {
  const server = await startMockServer((req) => {
    req.socket.destroy();
  });
  t.after(() => server.close());

  const result = await runCli(validArgs, {
    env: {
      CODEARTS_REQ_ENDPOINT: server.url,
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });

  assert.equal(result.code, 3, result.stderr);
  assert.match(result.stderr, /网络异常/);
  assert.equal(result.stdout, '');
});

test('CODEARTS_REQ_ENDPOINT 支持带路径前缀的网关', async (t) => {
  const server = await startMockServer(jsonResponse(200, issueFixture()));
  t.after(() => server.close());

  const result = await runCli(validArgs, {
    env: {
      CODEARTS_REQ_ENDPOINT: `${server.url}/gateway/`,
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    server.requests[0].url,
    `/gateway/v4/projects/${PROJECT_ID}/issue`,
  );
});

test('标准带连字符 UUID 可正常使用并保留在请求路径中', async (t) => {
  const hyphenated = '526cefde-6200-4de2-b62b-5e8dd2c2b3af';
  const server = await startMockServer(jsonResponse(200, issueFixture()));
  t.after(() => server.close());

  const result = await runCli([
    'issue', 'create', '测试连字符 UUID',
    '--project-id', hyphenated,
    '--tracker', '3',
    '--priority', '3',
  ], {
    env: {
      CODEARTS_REQ_ENDPOINT: server.url,
      CODEARTS_REQ_AK: AK,
      CODEARTS_REQ_SK: SK,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(server.requests[0].url, `/v4/projects/${hyphenated}/issue`);
});

test('导出的 run() 支持注入输出流和 fetch，并一次报告多个参数错误', async () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const streams = {
    stdout: { write: (value) => stdoutChunks.push(value) },
    stderr: { write: (value) => stderrChunks.push(value) },
  };

  const code = await run(
    ['issue', 'create', '--tracker', '9', '--priority', '5'],
    {},
    streams,
  );

  assert.equal(code, 2);
  const stderr = stderrChunks.join('');
  assert.match(stderr, /缺少必填参数：工作项标题/);
  assert.match(stderr, /缺少必填参数：--project-id/);
  assert.match(stderr, /--tracker 非法/);
  assert.match(stderr, /--priority 非法/);
  assert.equal(stdoutChunks.join(''), '');
});

test('导出的 run() 与 mock fetch 协作时可生成正确请求', async () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  let capturedUrl;
  let capturedInit;

  const fetchFn = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      json: async () => issueFixture({ name: 'run 测试' }),
    };
  };

  const hyphenated = '526cefde-6200-4de2-b62b-5e8dd2c2b3af';
  const code = await run([
    'issue', 'create', 'run 测试',
    '--project-id', hyphenated,
    '--tracker', '3',
    '--priority', '3',
    '--assigned-to', '4091',
    '--json',
  ], {
    CODEARTS_REQ_ENDPOINT: 'https://projectman-ext.cn-north-4.myhuaweicloud.com',
    CODEARTS_REQ_AK: AK,
    CODEARTS_REQ_SK: SK,
  }, {
    fetchFn,
    stdout: { write: (value) => stdoutChunks.push(value) },
    stderr: { write: (value) => stderrChunks.push(value) },
  });

  assert.equal(code, 0, stderrChunks.join(''));
  assert.equal(
    capturedUrl,
    `https://projectman-ext.cn-north-4.myhuaweicloud.com/v4/projects/${hyphenated}/issue`,
  );
  assert.match(
    capturedInit.headers.Authorization,
    /^SDK-HMAC-SHA256 Access=test-ak, SignedHeaders=host;x-sdk-date, Signature=[0-9a-f]{64}$/,
  );
  assert.match(capturedInit.headers['X-Sdk-Date'], /^\d{8}T\d{6}Z$/);
  assert.equal(JSON.parse(capturedInit.body).assigned_to, 4091);
  assert.equal(JSON.parse(stdoutChunks.join('')).name, 'run 测试');
});
