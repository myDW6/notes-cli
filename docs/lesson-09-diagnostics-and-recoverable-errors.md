# 第九课：诊断能力与可恢复错误

## 课程目标

让 CLI 错误提供稳定的恢复信息，并通过只读 `doctor` 命令汇总环境问题，使人类和 Agent 能区分“命令执行失败”与“诊断发现失败项”。

## 错误码决定是否重试

错误类别只表示大方向，不能决定原请求是否值得重试：

```text
IDEMPOTENCY_KEY_REUSED  conflict  retryable=false
STORAGE_LOCKED          conflict  retryable=true
INTERNAL                internal  retryable=false
TEMPORARY_IO_FAILURE    internal  retryable=true
```

本课将恢复策略集中在 `cli/errors.ts`，由具体错误码提供：

- `retryable`
- 默认 `hint`
- 默认 `nextSteps`

调用点仍可以在确有上下文时显式覆盖策略，但不能再依赖 `conflict` 或 `internal` 这样的类别默认值。

## 可执行的恢复路径

已知错误可以自动补充恢复建议：

```json
{
  "code": "CONFIG_PARSE_ERROR",
  "retryable": false,
  "hint": "Fix the config JSON or recreate the configuration file.",
  "nextSteps": [
    "notes config init --no-input",
    "notes config effective --output json"
  ]
}
```

`nextSteps` 是建议，不代表 CLI 会自动执行。诊断与修复必须分离，避免 Agent 在未授权时修改环境。

## Doctor 命令

```bash
notes doctor
notes doctor --output json
```

当前检查项使用稳定 ID：

```text
runtime.node
config.resolve
dataDir.type
dataDir.readable
dataDir.writable
storage.format
```

每项状态只能是：

```text
pass
warn
fail
skip
```

展示文案可以演进，但 Agent 应依赖检查 ID 和状态。

## 只读诊断

`doctor` 不会：

- 创建缺失的数据目录
- 修改文件权限
- 重写损坏的配置
- 迁移或删除存储文件
- 启动交互式提问

当数据目录尚不存在时，它会检查最近的现有父目录是否可写，但不会通过创建临时文件验证权限。

## 聚合而不是立即终止

配置损坏时：

```text
runtime.node       pass
config.resolve     fail
dataDir.type       skip
dataDir.readable   skip
dataDir.writable   skip
storage.format     skip
```

运行时检查与配置解析互相独立，因此仍能完成。依赖有效配置的检查标记为 `skip`，而不是制造更多重复失败。

## Envelope 与退出码

一次完整执行的诊断可能返回：

```json
{
  "ok": true,
  "command": "doctor",
  "data": {
    "status": "fail",
    "checks": []
  }
}
```

语义如下：

```text
ok=true           doctor 命令成功完成并生成报告
data.status=fail  环境中存在失败检查
exit code=1       Shell 和 CI 可以感知环境不健康
```

如果 `doctor` 自身因无效命令参数而无法启动，则使用正常错误 Envelope。

## 汇总状态

```text
存在 fail       -> report.status=fail，exit 1
无 fail 有 warn -> report.status=warn，exit 0
只有 pass/skip  -> report.status=pass，exit 0
```

`skip` 表示依赖条件不足，不等同于失败。

## 分层实现

```text
commands/doctor.ts
  注册命令、选择人类或机器输出、设置最终退出码

diagnostics/doctor.ts
  执行和汇总只读检查

config/resolver.ts
  负责配置读取与校验

notes/storage.ts
  负责识别存储格式

cli/errors.ts
  负责错误恢复策略
```

诊断层调用已有能力，不复制配置优先级或存储格式解析逻辑。

## 本课结论

1. Agent 应依赖错误码，不能解析错误文案。
2. `retryable` 应由具体错误码决定。
3. 已知错误应提供可执行但不自动执行的恢复步骤。
4. Doctor 检查项需要稳定 ID 和有限状态集合。
5. 诊断必须只读，修复需要单独命令和授权。
6. 独立检查应在其他检查失败后继续执行。
7. 诊断成功与环境健康是两个不同维度。
8. Envelope、报告状态和退出码应共同表达完整结果。
