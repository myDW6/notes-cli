# 第五课：幂等性与安全重试

## 课程目标

解决 Agent 执行写命令后未收到结果，无法判断操作是否已经成功的问题。

## 结果未知

```text
Agent -> CLI：创建 Note
CLI -> 磁盘：创建成功
CLI -> Agent：响应丢失
```

Agent 如果直接重试普通 `create`，可能创建重复数据。

## Idempotency Key

调用者为同一个业务意图提供稳定 key：

```bash
notes create \
  --title "Agent note" \
  --idempotency-key task-123 \
  --output json
```

首次执行返回：

```json
{
  "idempotency": {
    "key": "task-123",
    "fingerprint": "sha256:...",
    "replayed": false
  }
}
```

使用相同 key 和相同输入重试时，CLI 返回首次结果，不创建第二条 Note：

```json
{
  "idempotency": {
    "key": "task-123",
    "fingerprint": "sha256:...",
    "replayed": true
  }
}
```

## Key 与请求指纹

```text
idempotency key：标识同一个业务意图
fingerprint：标识该意图对应的规范化输入
```

相同 key、不同输入返回：

```text
IDEMPOTENCY_KEY_REUSED
category = conflict
exit code = 11
```

CLI 不会覆盖第一次记录，也不会猜测调用者的新意图。

## 规范化与稳定序列化

指纹基于应用默认值处理后的请求：

```json
{
  "title": "A",
  "content": "",
  "tags": []
}
```

对象字段按名称稳定排序后，再计算 SHA-256。request ID、时间戳等每次变化的数据不会进入指纹。

## 持久化设计

`notes.json` 从旧的 Note 数组升级为：

```json
{
  "schemaVersion": 2,
  "notes": [],
  "idempotency": {}
}
```

读取时兼容旧数组格式。写入时，Note 与幂等记录在同一个状态文件中提交，并通过临时文件加 rename 替换，降低进程中断产生半截 JSON 的风险。

幂等记录独立于 Note 生命周期。即使 Note 后来被删除，相同 key 的重试仍代表原来的业务意图，而不是一次新的创建。

## Dry-run

带 key 的 dry-run 会展示 key 和指纹，但不会保存幂等记录：

```bash
notes create \
  --title A \
  --idempotency-key task-123 \
  --dry-run \
  --output json
```

因此正式执行仍然返回 `replayed: false`。

## 能力发现

`capabilities` 中的 create 声明：

```json
{
  "supportsIdempotencyKey": true,
  "idempotencyRequired": false
}
```

本项目没有强制所有 create 使用 key，以保留人类快速使用体验。Agent 执行重要写操作时应主动提供稳定 key。

## 当前边界

本课保证顺序重试可以安全重放，并使用单文件提交保持 Note 与幂等记录一致。

当前 JSON 存储仍没有跨进程锁。两个真正同时开始的 create 进程仍可能发生竞争。生产级实现通常使用文件锁、SQLite 事务或服务端数据库解决并发串行化问题。

## 本课结论

1. `retryable` 和 `idempotent` 是不同概念。
2. 幂等键必须由调用者生成并在重试时复用。
3. 相同 key 和相同输入重放首次结果。
4. 相同 key 和不同输入必须明确冲突。
5. 指纹基于规范化输入和稳定序列化。
6. dry-run 不应占用幂等键。
7. 幂等记录需要持久化，不能只保存在当前进程内存。
