# 第三课：机器输出协议

## 课程目标

让脚本和 AI Agent 能够稳定判断 CLI 是否成功、提取业务结果，并根据结构化错误决定下一步操作。

核心认识：

> 输出 JSON 不等于建立了机器协议。Agent First 需要稳定、统一、无污染且可版本化的输出契约。

## CLI 的三个结果通道

CLI 通过三个相互独立的通道表达执行结果：

```text
stdout     命令结果
stderr     错误与诊断
exit code  执行状态
```

推荐约定：

| 场景 | stdout | stderr | Exit code |
|---|---|---|---:|
| 成功 | 结构化结果 | 空 | `0` |
| 业务失败 | 空 | 结构化错误 | 非 `0` |
| 内部失败 | 空 | 结构化错误 | `1` |

Agent 的典型处理流程：

1. 检查 exit code。
2. 成功时解析 stdout。
3. 失败时解析 stderr。
4. 使用 `error.code` 决定如何处理错误。

不能只使用其中一个通道。例如，下面的结果是错误设计：

```text
exit code = 0
{"ok":false}
```

Shell 会把它判断为成功。

## stdout 与 stderr 的边界

机器模式下：

- stdout 只包含命令结果。
- stderr 只包含错误或明确启用的诊断信息。
- JSON 中不能混入颜色、进度条、成功符号和自然语言提示。

下面的 stdout 不是合法机器协议：

```text
✓ Note created: abc123
{"id":"abc123"}
```

整个 stdout 无法作为一个 JSON 文档解析。

成功时也不应向 stderr 输出 `Done` 等提示。stderr 是否有内容，常被自动化工具用来辅助诊断，随意输出会增加歧义。

## 统一成功 Envelope

不直接输出裸业务对象，而是使用统一协议层：

```json
{
  "ok": true,
  "apiVersion": "notes.cli/v1",
  "command": "create",
  "requestId": "req_123",
  "data": {
    "id": "abc",
    "title": "CLI Design",
    "content": "",
    "tags": []
  }
}
```

字段职责：

- `ok`：快速区分成功与失败。
- `apiVersion`：机器协议版本。
- `command`：本次执行的命令。
- `requestId`：关联本次执行与诊断信息。
- `data`：命令的业务结果。

对应的 TypeScript 类型：

```ts
interface SuccessEnvelope<T> {
  ok: true;
  apiVersion: 'notes.cli/v1';
  command: string;
  requestId: string;
  data: T;
}
```

## 为什么需要 Envelope

裸业务对象没有清晰区分协议元数据与业务字段：

```json
{
  "id": "abc",
  "title": "A"
}
```

以后增加 `apiVersion`、`requestId` 等协议字段时，它们会与业务字段混合，甚至可能发生命名冲突。

Envelope 建立了明确边界：

```text
顶层：协议元数据
data：业务数据
```

所有命令都应保持相同顶层结构。不能让 `create` 输出裸 Note，而 `list` 使用 Envelope，否则 Agent 必须为每个命令编写不同的解析逻辑。

## 列表结果

列表数据及分页信息放在 `data` 内：

```json
{
  "ok": true,
  "apiVersion": "notes.cli/v1",
  "command": "list",
  "requestId": "req_123",
  "data": {
    "items": [
      {
        "id": "abc",
        "title": "A"
      }
    ],
    "page": {
      "hasMore": true,
      "nextCursor": "cursor_xyz"
    }
  }
}
```

空列表仍然是成功：

```json
{
  "ok": true,
  "data": {
    "items": [],
    "page": {
      "hasMore": false
    }
  }
}
```

## 统一错误 Envelope

推荐错误结构：

```json
{
  "ok": false,
  "apiVersion": "notes.cli/v1",
  "command": "get",
  "requestId": "req_123",
  "error": {
    "category": "not_found",
    "code": "NOTE_NOT_FOUND",
    "message": "Note was not found",
    "retryable": false,
    "details": {
      "id": "abc"
    }
  }
}
```

对应类型：

```ts
interface ErrorEnvelope {
  ok: false;
  apiVersion: 'notes.cli/v1';
  command: string;
  requestId: string;
  error: {
    category: string;
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}
```

## 错误字段的职责

### `code`

`code` 是 Agent 精确判断错误的稳定依据：

```ts
if (error.code === 'NOTE_NOT_FOUND') {
  // 更换 ID 或停止后续操作
}
```

Agent 不应解析自然语言：

```ts
if (error.message.includes('not found')) {
  // 不稳定
}
```

`message` 可以改善措辞，已经发布的 `code` 不应随意修改。

### `category`

`category` 提供粗粒度分类，并可以映射到 exit code：

```text
usage
config
not_found
permission
conflict
internal
```

### `details`

`details` 保存机器可处理的上下文：

```json
{
  "code": "INVALID_ARGUMENT",
  "details": {
    "argument": "limit",
    "value": "abc",
    "expected": "integer between 1 and 1000"
  }
}
```

不应把这些信息全部塞进 `message`。

### `retryable`

`retryable: true` 只表示：

> 在条件可能恢复的情况下，使用相同请求重试有机会成功。

它不代表 Agent 应立即、无限、无条件地重试。

Agent 仍需考虑：

- 最大重试次数。
- 指数退避和随机抖动。
- 操作是否幂等。
- 是否提供 `retryAfterMs`。
- 重试成本及副作用。

例如：

| 错误 | retryable |
|---|---:|
| 缺少标题 | `false` |
| Note 不存在 | `false` |
| 参数冲突 | `false` |
| 临时文件锁冲突 | `true` |
| 暂时性服务错误 | `true` |

## Exit Code 与错误码

两者不能互相替代：

```text
exit code：供 Shell 做粗粒度判断
error.code：供 Agent 做精确判断
```

例如：

```text
error.code = NOTE_NOT_FOUND
category = not_found
exit code = 6
```

即使 stderr 已经输出 `{"ok":false}`，进程仍然必须返回非零退出码。

## 协议版本

`apiVersion` 表示机器协议版本，不是 npm 包版本：

```json
{
  "apiVersion": "notes.cli/v1"
}
```

npm 包可以发布多个兼容版本：

```text
1.0.2
1.1.0
1.5.0
```

只要机器协议保持兼容，`apiVersion` 就不需要变化。只有破坏性修改协议时，才升级到 `notes.cli/v2`。

## JSON 格式约定

机器输出默认应当：

- 使用紧凑 JSON。
- 只输出一个完整 JSON 文档。
- 不包含 ANSI 颜色。
- 不包含提示语、进度条或成功符号。
- 以换行符结束，方便 Shell 组合。

需要人类阅读时，可以显式使用：

```bash
notes list --output json --pretty
```

默认 pretty print 会增加输出体积，因此不适合作为 Agent 默认协议。

## 避免无意义的动态元数据

不要为了显得完整而默认加入：

```json
{
  "timestamp": "...",
  "durationMs": 13,
  "hostname": "...",
  "pid": 123
}
```

无必要的动态字段会：

- 增加 Agent 上下文。
- 破坏稳定的快照测试。
- 使输出难以比较。
- 泄露不必要的运行环境信息。

只保留确实具有协议价值的字段。

## `--verbose` 的边界

默认机器模式下，stderr 应保持为单个可解析的错误 JSON。

`--verbose` 可能向 stderr 增加诊断日志，从而破坏“单个 JSON 文档”的性质。因此 v1 暂定：

- Agent 的正常调用不使用 `--verbose`。
- 开启 `--verbose` 表示调用者接受额外诊断输出。
- 未来如果需要机器解析日志，可定义独立 JSONL 诊断协议。

## 练习结论

| 设计 | 结论 | 原因 |
|---|---|---|
| 成功时 stdout 输出 JSON，stderr 输出 `Done` | 不合理 | 成功时不应污染 stderr |
| 找不到 Note 时 exit code 为 `0`，JSON 中 `ok=false` | 不合理 | 失败必须返回非零退出码 |
| 只有错误 message，没有 `error.code` | 不合理 | Agent 缺少稳定判断依据 |
| `list` 的 `data` 包含 `items` 和 `page` | 合理 | 业务数据与分页信息边界清晰 |
| `create` 输出裸 Note，`list` 使用 Envelope | 不合理 | 顶层协议不统一 |
| JSON 默认使用 pretty 格式 | 不合理 | Agent 默认应使用紧凑输出 |
| `retryable=true` 时 Agent 立即原样重试 | 不完全合理 | 还需考虑退避、次数、幂等和副作用 |
| `apiVersion` 使用 npm 包版本 `1.0.2` | 不合理 | 协议版本和软件版本职责不同 |

## 本课结论

1. JSON 只是编码格式，不是完整的机器协议。
2. stdout、stderr 和 exit code 必须各司其职。
3. 所有命令应使用一致的成功与错误 Envelope。
4. 协议元数据放在顶层，业务结果放在 `data`。
5. Agent 使用稳定的 `error.code`，不解析自然语言 message。
6. `retryable` 是重试提示，不是立即重试指令。
7. `apiVersion` 表示协议兼容性，不跟随 npm 版本变化。
8. 机器输出默认紧凑、无颜色、无提示且无 stdout 污染。

## 后续实践方式

前三课先完成了契约设计，尚未修改代码。后续课程调整为：

```text
概念讲解
-> 契约决策
-> 修改当前代码
-> 执行真实命令
-> 编写契约测试
-> 总结文档并提交
```

下一阶段将把前三课落实到当前项目：

- 将 `--format` 统一为 `--output`。
- 增加 `--no-input` 和运行模式解析。
- JSON 模式禁止隐式交互和颜色。
- 成功与失败使用统一 Envelope。
- 严格分离 stdout、stderr 和 exit code。
- 修复 `create` 的 stdout 污染。
- 验证 `create`、`list`、`delete` 的参数契约。
- 增加真实 CLI 黑盒测试。
