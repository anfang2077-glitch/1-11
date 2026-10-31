# req-cli

用 Node.js 编写的华为云 CodeArts 需求管理命令行工具，封装 **创建工作项（CreateIssueV4）** 接口：

```text
POST /v4/projects/{project_id}/issue
```

使用 AK/SK 签名鉴权（`SDK-HMAC-SHA256`），无第三方运行时依赖，要求 Node.js >= 18。

## 功能

- `issue create <title>`：创建工作项，支持标题、类型、优先级、状态、严重程度、处理人、父工作项、迭代和起止日期。
- `--json`：以 JSON 输出工作项的完整 API 响应。
- 完整的参数校验：缺失必填项、类型/优先级/严重程度非法、日期非法等都会给出中文提示。
- 缺少环境变量时直接报错退出，不会发送任何请求。
- API 错误透传 `error_code` / `error_msg`；网络异常与参数错误使用不同退出码。
- 根命令、`issue`、`issue create` 均提供 `--help`。

## 环境要求

- Node.js >= 18（使用内置 `fetch`、`node:crypto`、`node:test`）
- 可访问 CodeArts Req 终端节点的网络
- 已获取华为云访问密钥 AK/SK

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `CODEARTS_REQ_ENDPOINT` | 是 | CodeArts Req 终端节点，必须带 `https://` 或 `http://`，如 `https://projectman-ext.cn-north-4.myhuaweicloud.com` |
| `CODEARTS_REQ_AK` | 是 | 访问密钥 AK |
| `CODEARTS_REQ_SK` | 是 | 访问密钥 SK |

不同区域的终端节点不同，请从华为云 CodeArts Req 文档的“终端节点”章节选择，例如：

| 区域 | 终端节点 |
| --- | --- |
| 华北-北京四（cn-north-4） | `https://projectman-ext.cn-north-4.myhuaweicloud.com` |
| 华北-北京一（cn-north-1） | `https://projectman-ext.cn-north-1.myhuaweicloud.com` |
| 华东-上海一（cn-east-3） | `https://projectman-ext.cn-east-3.myhuaweicloud.com` |
| 华南-广州（cn-south-1） | `https://projectman-ext.cn-south-1.myhuaweicloud.com` |

PowerShell：

```powershell
$env:CODEARTS_REQ_ENDPOINT = "https://projectman-ext.cn-north-4.myhuaweicloud.com"
$env:CODEARTS_REQ_AK       = "你的 AK"
$env:CODEARTS_REQ_SK       = "你的 SK"
```

Bash / Zsh：

```bash
export CODEARTS_REQ_ENDPOINT="https://projectman-ext.cn-north-4.myhuaweicloud.com"
export CODEARTS_REQ_AK="你的 AK"
export CODEARTS_REQ_SK="你的 SK"
```

> 缺少 `CODEARTS_REQ_ENDPOINT`、`CODEARTS_REQ_AK`、`CODEARTS_REQ_SK` 中任意一个时，程序会以退出码 `2` 报错退出，且不会发出 HTTP 请求。

## 运行

在本目录执行：

```bash
node req-cli.mjs --help
```

也可以安装为本地命令：

```bash
npm link
req-cli --help
```

## 用法

```text
req-cli issue create <title> [选项]
```

### 位置参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<title>` | 是 | 工作项标题，1~512 个字符；包含空格时请使用引号 |

### 必填选项

| 选项 | 说明 |
| --- | --- |
| `--project-id <uuid>` | 项目 ID，32 位 UUID（32 个十六进制字符；也接受带标准连字符的写法，并原样用于请求路径） |
| `--tracker <id>` | 工作项类型：`2` Task / `3` Bug / `5` Epic / `6` Feature / `7` Story |
| `--priority <id>` | 优先级：`1` 低 / `2` 中 / `3` 高 |

### 选填选项

| 选项 | 说明 |
| --- | --- |
| `--description <text>` | 工作项描述 |
| `--status-id <id>` | 状态：`1` 新建（默认）/ `2` 进行中 / `3` 已解决 / `4` 测试中 / `5` 已关闭 / `6` 已拒绝 |
| `--severity <id>` | 严重程度：`10` 关键 / `11` 重要 / `12` 一般 / `13` 提示 |
| `--assigned-to <id>` | 处理人数字 ID |
| `--parent-issue <id>` | 父工作项 ID |
| `--iteration <id>` | 迭代 ID |
| `--begin <yyyy-mm-dd>` | 开始日期，如 `2024-03-01` |
| `--end <yyyy-mm-dd>` | 结束日期，如 `2024-04-30` |
| `--json` | 以 JSON 输出 API 响应 |
| `-h`, `--help` | 显示当前命令帮助 |

日期必须是真实存在的 `yyyy-mm-dd` 日期，例如 `2023-02-29` 会被拒绝。

## 示例

### 创建一个 Bug

```bash
node req-cli.mjs issue create "修复登录页面白屏" \
  --project-id 526cefde62004de2b62b5e8dd2c2b3af \
  --tracker 3 \
  --priority 3 \
  --severity 11 \
  --description "用户登录后页面白屏，需要排查"
```

### 创建 Task 并以 JSON 输出

```bash
node req-cli.mjs issue create "编写单元测试" \
  --project-id 526cefde62004de2b62b5e8dd2c2b3af \
  --tracker 2 \
  --priority 2 \
  --json
```

### 创建 Story，指定状态、迭代、处理人和日期

```bash
node req-cli.mjs issue create "用户中心重构" \
  --project-id 526cefde62004de2b62b5e8dd2c2b3af \
  --tracker 7 \
  --priority 2 \
  --status-id 2 \
  --iteration 401 \
  --assigned-to 4091 \
  --begin 2024-03-01 \
  --end 2024-04-30
```

### 查看帮助

```bash
node req-cli.mjs --help
node req-cli.mjs issue --help
node req-cli.mjs issue create --help
```

`--help` 不依赖环境变量，可在配置 AK/SK 之前查看。

## 输出

默认输出摘要：

```text
工作项创建成功
  ID:       1377843
  标题:      修复登录页面白屏
  类型:      3 (Bug)
  优先级:    3 (高)
  状态:      1 (新建)
```

使用 `--json` 时，stdout 只输出完整 API 响应，便于 `jq` 等工具处理：

```json
{
  "id": 1377843,
  "name": "修复登录页面白屏",
  "tracker": { "id": 3, "name": "Bug" },
  "priority": { "id": 3, "name": "高" },
  "status": { "id": 1, "name": "新建" },
  "severity": { "id": 11, "name": "重要" }
}
```

> 实际响应还包含 `project`、`assigned_user`、`created_time` 等字段，工具会原样输出服务端返回内容。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | API 报错（stderr 透传 `error_code` / `error_msg`；响应非 JSON 时也会报错） |
| `2` | 参数错误或配置错误（缺必填项、非法 tracker/priority/severity/status、日期格式错误、缺少环境变量等） |
| `3` | 网络异常（连接失败、超时、响应读取失败等） |

参数错误时，stderr 会输出中文提示（多个错误会一次列出），例如：

```text
参数错误：
  - --tracker 非法，允许值：2 Task / 3 Bug / 5 Epic / 6 Feature / 7 Story
  - --priority 非法，允许值：1 低 / 2 中 / 3 高
提示：运行 "req-cli issue create --help" 查看用法。
```

API 错误时，stderr 类似：

```text
API 错误：HTTP 400，error_code=APIGW.0301，error_msg=Incorrect IAM authentication information
```

## 与 API 的对应关系

请求体字段映射：

| CLI 参数 | API 请求体字段 | 类型 |
| --- | --- | --- |
| `<title>` | `name` | String |
| `--tracker` | `tracker_id` | Integer |
| `--priority` | `priority_id` | Integer |
| `--description` | `description` | String |
| `--status-id` | `status_id` | Integer（默认 `1`） |
| `--severity` | `severity_id` | Integer |
| `--assigned-to` | `assigned_to` | Integer |
| `--parent-issue` | `parent_issue_id` | Integer |
| `--iteration` | `iteration_id` | Integer |
| `--begin` | `begin_time` | String（`yyyy-mm-dd`） |
| `--end` | `end_time` | String（`yyyy-mm-dd`） |

请求路径：

```text
POST {CODEARTS_REQ_ENDPOINT}/v4/projects/{project_id}/issue
Content-Type: application/json
X-Sdk-Date: 20261031T083000Z
Authorization: SDK-HMAC-SHA256 Access=<AK>, SignedHeaders=content-type;host;x-sdk-date, Signature=<hex>
```

签名说明：

- 算法：`SDK-HMAC-SHA256`
- 参与签名的请求头：`host`、`x-sdk-date`；`content-type` 会随请求发送
- CanonicalURI 按华为云签名规范以 `/` 结尾
- 签名内容为规范请求（CanonicalRequest）的 SHA-256 摘要，使用 SK 做 HMAC-SHA256
- AK 会按签名协议出现在 `Authorization` 的 `Access=` 字段中；SK 不会发送，也不会被程序打印

## 测试

测试使用 Node.js 内置 `node:test`，通过本地 HTTP mock 服务验证请求构造、签名、响应处理和退出码，不访问真实华为云：

```bash
npm test
```

覆盖内容包括：

- 所有层级的 `--help`
- 缺少环境变量、非法终端节点
- 缺失必填项、非法 tracker/priority/status/severity、非法日期、超长标题
- 请求路径、请求体字段映射、`X-Sdk-Date`、`Authorization` 签名校验
- 导出的 `run()` 注入输出流 / mock fetch 的单元测试
- `--json` 输出
- API 错误透传与退出码
- 网络异常退出码

## 安全提示

- 不要把 AK/SK 写入源码、README 或提交到版本库；只通过环境变量传入。
- 建议使用具备最小权限的 IAM 用户访问密钥。
- 本工具不会在日志中输出 AK/SK 或 `Authorization` 签名。
- 如果终端节点使用自建代理网关，请注意 HTTPS 证书校验；不要在生产环境关闭 TLS 校验。
