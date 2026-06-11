# 第十三课：重试、退避与限流

## 学习目标

本课把 `retryable` 从错误字段落实为可控的执行机制：

1. 自动重试默认关闭。
2. 只有结构化错误明确声明 `retryable: true` 才会重试。
3. 非幂等操作不能启用自动重试。
4. 重试次数、退避时间和总超时都有明确上限。
5. 尝试过程写入诊断日志，不污染结果协议。

## CLI 契约

```bash
notes list --max-retries 3 --output json
```

`--max-retries 3` 的准确含义是：

```text
总尝试次数上限 = 1 次初始调用 + 3 次重试
```

允许范围是 `0..10`，默认值为 `0`。默认关闭可以避免 CLI 和上层 Agent
同时重试造成请求数量相乘。

## 通用执行边界

重试实现位于 `cli/retry.ts`，命令通过统一入口执行操作：

```ts
await context.run(
  () => remoteOperation(),
  { idempotent: true },
);
```

调用方必须显式声明幂等性。开启重试后，如果传入
`idempotent: false`，执行器会在调用操作前返回：

```text
UNSAFE_RETRY
```

这比依赖开发者“记住不要重试”更可靠。

## 读写操作的差异

读取操作天然不会新增或重复修改资源：

```bash
notes list --max-retries 3
notes get abc --max-retries 3
notes search CLI --max-retries 3
```

create 只有在提供幂等键时才允许：

```bash
notes create \
  --title "Agent CLI" \
  --idempotency-key request-123 \
  --max-retries 3
```

下面的调用会在写入前失败：

```bash
notes create --title "duplicate risk" --max-retries 3
```

当前 update 和 delete 没有幂等请求协议，因此不会因为“看起来可能安全”
就自动重试。

## 退避算法

本项目使用有上限的指数退避：

```text
baseDelayMs = 200
maxDelayMs  = 5000
```

每次基础延迟按指数增长：

```text
200ms, 400ms, 800ms, 1600ms ...
```

然后加入 `0.5..1.5` 的随机抖动，并再次限制到最大值。抖动避免多个 Agent
在同一时刻重新发送请求。

## retryAfterMs

服务端或底层适配器可以在错误详情中返回：

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "retryable": true,
    "details": {
      "retryAfterMs": 2000
    }
  }
}
```

执行器优先采用 `retryAfterMs`，否则才计算本地退避。

## 总超时预算

```bash
notes list --max-retries 5 --timeout 10s
```

10 秒覆盖：

- 初始尝试；
- 每次操作；
- 退避等待；
- 后续重试。

所有阶段共享同一个 `AbortSignal`。退避等待可被超时、`SIGINT` 或
`SIGTERM` 中断，不会为每次尝试重新获得 10 秒。

## 日志与输出

stdout 仍然只包含最终结果，stderr 仍然只包含最终结构化错误。

启用日志文件后，重试过程以稳定事件记录：

```json
{"event":"retry.scheduled","attempt":2,"maxAttempts":4,"delayMs":237,"source":"backoff","errorCode":"TEMPORARY_IO_FAILURE"}
{"event":"retry.started","attempt":2,"maxAttempts":4}
```

Agent 可以观察过程，但不需要从 stdout 中删除调试文本。

## 能力发现

`notes capabilities --output json` 声明：

- 默认是否自动重试；
- 最大重试次数；
- 总尝试次数定义；
- 退避算法和上下限；
- 是否尊重 `retryAfterMs`；
- 是否共享总超时；
- 每个命令是否支持自动重试。

这可以避免 Agent 和 CLI 在不知道对方行为的情况下同时重试。

## 本课工程结论

1. `retryable` 是候选条件，不是无限重试指令。
2. 自动重试必须默认关闭并设置次数上限。
3. 写操作必须先证明幂等，再允许重试。
4. 退避等待属于总超时预算。
5. 服务端等待建议优先于本地退避。
6. 重试过程属于日志，不属于结果协议。
