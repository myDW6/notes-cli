# CLI Architecture

本项目采用按职责分层、按用例拆命令的结构。目标不是追求目录数量，而是让参数框架、执行协议和业务行为可以独立演进。

## Layers

```text
src/
  index.ts             进程入口
  commands.ts          composition root

  cli/
    program.ts         Commander 生命周期与全局选项
    runtime.ts         调用状态、配置缓存与 CommandContext
    parsers.ts         纯参数解析
    errors.ts          结构化错误协议
    output.ts          成功与失败输出协议
    execution.ts       交互、TTY 与输出模式
    process.ts         broken pipe 等进程边界

  commands/
    discovery.ts       能力和 Schema 命令
    config.ts          配置命令
    batch.ts           批处理命令
    notes-read.ts      只读 notes 命令
    notes-write.ts     写入和交互 notes 命令
    export.ts          原始导出命令

  config/
    resolver.ts        配置读取、校验、优先级和来源追踪

  notes/
    types.ts           领域模型
    storage.ts         本地持久化和 notes 操作
    idempotency.ts     幂等键和请求指纹

  batch/
    processor.ts       JSONL 批处理服务

  protocol/
    discovery.ts       Agent 能力描述和输入 Schema

tests/
  unit/
    cli/               CLI 基础设施单元测试
    config/            配置解析单元测试
    notes/             notes 领域与存储单元测试
    batch/             批处理服务单元测试
    protocol/          Agent 协议单元测试

  integration/
    cli.test.ts        CLI 进程级端到端契约
```

## Dependency Rules

1. `commands.ts` 只负责创建对象和注册模块，不实现具体命令。
2. `commands/` 可以调用领域能力和 `CommandContext`，但不能自行解析全局配置优先级。
3. `cli/` 不依赖任何具体命令模块。
4. `notes/`、`batch/` 等领域和服务模块不依赖 Commander、TTY 或控制台输出。
5. 输出 Envelope、错误 Envelope 和执行模式只能通过公共协议模块生成。
6. 纯参数解析放在 `cli/parsers.ts`，不与文件系统或进程状态混合。
7. 运行时代码只放在 `src/`；测试统一放在 `tests/` 并按单元测试和集成测试分类。

## Command Context

`CommandContext` 提供命令应用层需要的公共能力：

```text
config()       获取本次执行缓存后的有效配置
emit()         输出单个成功结果
emitList()     输出分页列表
humanOutput    判断是否允许人类提示
state          访问 requestId、mode 和 exitCode 等执行状态
```

这避免每个 command action 重复拼装输出参数、重新加载配置或自行判断机器模式。

## Adding A Command

1. 在 `commands/` 新建或选择一个职责匹配的注册模块。
2. 通过 `registerXxxCommand(program, context)` 注册命令。
3. 输入校验留在命令边界，领域操作委托给独立模块。
4. 成功结果通过 `context.emit()` 输出，失败抛出 `CLIError`。
5. 在 `commands.ts` 的 composition root 注册模块。
6. 为命令契约增加 `tests/integration/` 测试；纯解析或领域逻辑增加对应的 `tests/unit/` 测试。

## Current Trade-off

`notes/storage.ts` 目前同时包含文件仓库和部分 notes 领域操作。当前规模下保持它们在同一模块仍可理解；当增加远程存储或第二种仓库实现时，再拆成 repository interface 与 local file adapter，而不是提前引入抽象。
