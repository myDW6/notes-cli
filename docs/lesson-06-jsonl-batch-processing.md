# 第六课：JSONL 批处理与部分失败

## 课程目标

让 Agent 在一次 CLI 调用中顺序执行多条写操作，并能区分单项失败与整个批次无法启动。

## 命令契约

```bash
notes batch \
  --input-jsonl <path|-> \
  --output jsonl \
  [--fail-fast]
```

v1 只支持 `create` 和 `delete`，并强制显式使用 JSONL 输出。

## 输入格式

每个非空行是一个独立操作：

```jsonl
{"operation":"create","idempotencyKey":"task-1","input":{"title":"A"}}
{"operation":"delete","input":{"id":"note_123"},"confirm":true}
```

空行被跳过。`line` 是从 1 开始的物理行号，`index` 是从 0 开始的非空处理项编号。无效 JSON 仍占用一个 index。

## 输出格式

每条结果独立输出一行：

```jsonl
{"apiVersion":"notes.cli/v1","requestId":"req_...","index":0,"line":1,"operation":"create","ok":true,"data":{"id":"..."}}
{"apiVersion":"notes.cli/v1","requestId":"req_...","index":1,"line":2,"operation":"delete","ok":false,"error":{"code":"NOTE_NOT_FOUND"}}
```

批次内的单项失败属于正常批次结果，因此写 stdout。只有输入文件无法打开、全局参数错误或配置错误等导致批次无法开始的问题才写 stderr。

## 退出码

| 场景 | Exit code |
|---|---:|
| 全部成功 | `0` |
| 默认模式出现单项失败 | `12` |
| `--fail-fast` 出现失败 | 首个错误类别对应的退出码 |
| 批次无法启动 | 对应批次级错误退出码 |

Agent 不能只看 exit code，还必须逐行解析结果。

## Continue 与 Fail Fast

默认模式会继续执行后续行，以便 Agent 收集完整结果：

```text
成功 -> 失败 -> 成功
```

`--fail-fast` 在第一项失败后停止，但不会回滚此前成功的写操作。批处理不是事务。

## 批处理与幂等性

每条 create 使用独立幂等键：

```jsonl
{"operation":"create","idempotencyKey":"task-1","input":{"title":"A"}}
{"operation":"create","idempotencyKey":"task-2","input":{"title":"B"}}
```

整个文件重试时，已成功项返回 `replayed:true`，避免重复创建。一个批次级 key 无法正确表达部分成功，因此 v1 不提供批次整体幂等键。

## 删除确认

批处理永远不会交互询问。delete 必须在对应行显式声明：

```json
{
  "operation": "delete",
  "input": { "id": "note_123" },
  "confirm": true
}
```

缺少确认或 `confirm:false` 会产生该行的 `CONFIRMATION_REQUIRED` 错误。

## Schema 与能力发现

```bash
notes schema batch --output json
notes capabilities --output json
```

Schema 描述每行允许的结构。Capabilities 声明：

- 输入格式为 JSONL。
- 输出必须为 JSONL。
- 支持 `create` 和 `delete`。
- 支持 fail-fast。
- `atomic:false`，不提供事务回滚。

## 当前边界

v1 按输入顺序串行执行，不提供并发。这样可以保持输出顺序稳定，也能减少当前单文件 JSON 存储的竞争风险。

输入按行消费，不需要一次把整个文件加载进内存。但每个操作仍会独立读取和写入当前状态文件，因此它适合教学和中小批次，不是高吞吐导入器。

## 本课结论

1. 单项失败写 stdout，批次级失败写 stderr。
2. JSONL 支持逐行读取、逐行输出和部分成功。
3. 部分失败必须返回非零退出码。
4. fail-fast 只停止后续操作，不会回滚。
5. 每条写操作应拥有独立幂等键。
6. v1 串行执行，优先保证顺序和可理解性。
