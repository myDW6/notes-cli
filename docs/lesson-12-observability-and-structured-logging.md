# 第十二课：可观测性与结构化日志

## 学习目标

这一课把“打印调试信息”改造成稳定的 CLI 可观测性契约：

1. 结果、错误和日志使用不同通道。
2. 日志默认关闭，不增加正常调用的噪音。
3. 人类和 Agent 都能通过 `requestId` 关联一次执行。
4. 日志事件使用稳定名称，而不是依赖自然语言文本。
5. 日志系统故障不能改变业务结果。

## 三种不同协议

```text
stdout       成功结果
stderr       结构化失败
--log-file   执行过程中的诊断事件
```

机器模式的 stdout 和 stderr 已经是公开协议。把日志插入任意一个流，
都会使调用方无法再把整个流按原协议解析。因此本项目使用独立日志文件。

## 使用方式

日志默认关闭。只指定日志文件时，默认使用 `info` 级别和 JSON 格式：

```bash
notes list --output json --log-file ./notes.log
```

也可以显式选择级别和格式：

```bash
notes list --log-file ./notes.log --log-level debug
notes list --log-file ./notes.log --log-format text
```

`--log-level` 和 `--log-format` 不能脱离 `--log-file` 单独使用。没有明确
日志接收端的选项不会被静默忽略。

## JSONL 日志契约

日志文件中的每一行都是一个独立 JSON 对象：

```json
{"schemaVersion":"notes.log/v1","timestamp":"2026-06-11T09:00:00.000Z","level":"info","event":"command.started","requestId":"req_123","command":"list","output":"json","interactive":false}
{"schemaVersion":"notes.log/v1","timestamp":"2026-06-11T09:00:00.012Z","level":"info","event":"command.completed","requestId":"req_123","command":"list","exitCode":0,"durationMs":12}
```

关键字段：

- `schemaVersion`：日志协议版本，与业务 API 版本独立演进。
- `event`：稳定的机器标识，例如 `command.started`。
- `requestId`：关联日志与成功或失败 Envelope。
- `durationMs`：执行耗时，便于定位性能问题。

失败日志只记录稳定错误属性，不复制可能包含敏感数据的错误详情：

```json
{"event":"command.failed","error":{"category":"not_found","code":"NOTE_NOT_FOUND","retryable":false}}
```

## 分层设计

`cli/logger.ts` 负责：

- 日志级别过滤；
- JSON 和文本格式；
- 敏感字段递归脱敏；
- 文件生命周期；
- 日志写入故障隔离。

`AppState` 持有一次调用的 Logger，`CommandContext.log()` 提供给命令层。
入口执行链统一记录 `command.started`、`command.completed` 和
`command.failed`，避免每个命令重复实现生命周期日志。

## 失败语义

打开日志文件失败发生在命令执行前，是明确的配置错误：

```text
LOG_FILE_OPEN_ERROR
```

文件成功打开后，如果运行期间写入或关闭失败，Logger 会停止继续写入，
但不会覆盖：

- 原始成功结果；
- 原始结构化错误；
- 原始退出码。

这就是日志的 best-effort 语义。可观测性可以不完整，但不能改变被观察
对象的行为。

## Agent-first 价值

Agent 可以：

1. 从结果或错误 Envelope 获取 `requestId`。
2. 在 JSONL 日志中筛选同一个 `requestId`。
3. 使用稳定 `event` 和错误 `code` 判断执行阶段。
4. 使用 `durationMs` 识别超时前的慢操作。

Agent 不需要解析颜色、自然语言前缀或不稳定的调试句子。

## 本课工程结论

1. 日志不是结果协议的一部分。
2. 默认静默是一种兼容性保证。
3. 事件名和字段比日志句子更重要。
4. 请求关联应由基础设施统一提供。
5. 敏感字段必须在日志边界集中脱敏。
6. 日志故障不能反客为主地改变命令语义。
