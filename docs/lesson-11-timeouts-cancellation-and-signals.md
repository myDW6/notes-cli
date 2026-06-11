# 第十一课：超时、取消与信号处理

## 课程目标

为 CLI 建立统一取消模型，让超时、SIGINT 和 SIGTERM 能沿执行链传递，并让 JSONL 批处理在安全边界停止。

## 统一取消所有权

只有进程入口监听操作系统信号：

```text
index.ts
  SIGINT / SIGTERM
        |
        v
CancellationContext
        |
        v
AbortSignal
        |
        v
command -> service -> storage / network / child process
```

存储、批处理和未来的网络模块不分别注册 `process.on('SIGINT')`。否则同一个信号可能触发多套清理和退出逻辑。

## 带单位的超时

全局参数：

```bash
notes batch ... --timeout 500ms
notes batch ... --timeout 30s
notes batch ... --timeout 5m
notes batch ... --timeout 1h
```

不接受无单位数值：

```bash
notes batch ... --timeout 30
```

因为调用者无法从命令本身判断 `30` 表示毫秒还是秒。

解析器将 duration 统一转换为毫秒，执行层只接收明确数值。

## CancellationContext

`cli/cancellation.ts` 统一管理：

- 一个 `AbortController`
- 第一次取消原因
- 超时定时器
- SIGINT / SIGTERM
- 稳定退出码
- 结构化取消错误

第一次取消原因会被保留。收到 SIGINT 后又收到 SIGTERM，不会改变已经传播给执行链的原因。

## 稳定退出码

```text
timeout  124
SIGINT   130
SIGTERM  143
```

普通业务失败继续使用原有退出码。Agent 可以据此区分：

- 输入或配置错误
- 业务失败
- 部分批处理失败
- 执行超时
- 用户或系统取消

## 安全取消边界

批处理只在以下位置响应取消：

```text
读取下一项之前
完成当前项目之后
等待输入流期间
```

单个 notes 写入仍执行完整流程：

```text
创建临时文件
写入完整 JSON
原子 rename
返回项目结果
检查 AbortSignal
```

不会在临时文件写到一半或 rename 提交期间强制退出。

## JSONL 取消协议

普通项目行增加可选的类型标识：

```json
{
  "type": "item",
  "index": 0,
  "ok": true
}
```

取消后追加最终 summary：

```json
{
  "type": "summary",
  "status": "cancelled",
  "processed": 2,
  "succeeded": 2,
  "failed": 0,
  "cancellation": {
    "kind": "signal",
    "code": "OPERATION_CANCELLED",
    "retryable": false,
    "signal": "SIGINT"
  }
}
```

超时 summary：

```json
{
  "cancellation": {
    "kind": "timeout",
    "code": "OPERATION_TIMEOUT",
    "retryable": true,
    "timeoutMs": 30000
  }
}
```

已经输出的 item 行不会撤回。summary 描述已完成部分和终止原因。

## Retryable 的含义

```text
OPERATION_TIMEOUT    retryable=true
OPERATION_CANCELLED  retryable=false
```

超时表示稍后执行可能成功，但 CLI 不会自动重试。调用方仍需判断：

- 操作是否幂等
- 是否已经产生部分结果
- 是否应使用新的时间预算
- 是否需要退避

SIGINT 通常表达调用者主动取消，不应自动恢复原操作。

## 清理职责

入口使用 `finally`：

```ts
try {
  process.exitCode = await execute(argv, cancellation);
} finally {
  cancellation.dispose();
  removeSignalHandlers();
}
```

这样会清理超时定时器和信号监听器。不能依赖 `process.on('exit')` 等待异步清理。

批处理读取器也在 `finally` 中关闭 readline 和文件句柄。

## 能力发现

`capabilities` 声明：

```json
{
  "globalOptions": {
    "timeout": {
      "supported": true,
      "requiresUnit": true,
      "units": ["ms", "s", "m", "h"]
    }
  }
}
```

批处理额外声明取消 summary、错误码和退出码。Agent 无需解析帮助文本。

## 测试策略

本课包含三层测试：

1. Duration 解析和取消控制器单元测试。
2. 批处理首项完成后触发 AbortSignal 的安全边界测试。
3. 真实子进程收到 SIGINT，以及真实 `--timeout` 的集成测试。

真实 SIGINT 测试会在观察到第一条 item 输出后发送信号，验证：

```text
至少一项已安全完成
最后一行是取消 summary
stderr 为空
退出码是 130
```

## 本课结论

1. 只有入口负责操作系统信号。
2. 超时值必须有明确单位。
3. AbortSignal 应传到真正执行工作的服务。
4. 取消必须发生在安全边界。
5. 原子写入期间不应强制终止。
6. 部分 JSONL 结果需要协议化 summary。
7. 超时可重试不代表自动重试。
8. 清理逻辑应放在 `finally` 中。
