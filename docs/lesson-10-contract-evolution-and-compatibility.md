# 第十课：CLI 契约演进与向后兼容

## 课程目标

把兼容性从口头约定变成可发现的元数据、明确的弃用生命周期和自动化契约测试。

## CLI 版本与协议版本

本项目当前有两个独立版本：

```text
CLI version    1.0.2
API version    notes.cli/v1
```

CLI 可以发布兼容的新版本，而成功和失败 Envelope 仍保持 `notes.cli/v1`。只有机器协议发生破坏性变化时，才升级到新的 API version。

## 兼容别名

推荐选项是：

```bash
notes list --output json
```

旧选项继续作为隐藏别名：

```bash
notes list --format json
notes list -f json
```

隐藏帮助只影响新用户看到的推荐接口，不会破坏旧脚本。

## 集中的弃用定义

弃用元数据放在 `protocol/deprecations.ts`：

```json
{
  "name": "--format",
  "shortName": "-f",
  "replacement": "--output",
  "removalVersion": "2.0.0"
}
```

Commander 警告和 capabilities 都读取同一份定义，避免替代项或删除版本出现不一致。

## Agent 的结构化发现

```bash
notes capabilities --output json
```

返回：

```json
{
  "data": {
    "compatibility": {
      "deprecatedOptions": [
        {
          "name": "--format",
          "shortName": "-f",
          "replacement": "--output",
          "removalVersion": "2.0.0"
        }
      ]
    }
  }
}
```

Agent 不需要解析 help 或 stderr 文案，即可提前迁移调用方式。

## 人类警告边界

成功的人类输出模式使用旧参数时，stderr 会显示：

```text
Warning [DEPRECATED_OPTION]: --format is deprecated; use --output. It will be removed in 2.0.0.
```

警告在 Commander 的 `postAction` 阶段输出。这一点很重要：

- 命令成功后才输出弃用警告
- 机器模式不输出文本警告
- 命令失败时 stderr 仍然只有一个 JSON 错误文档

如果在 `preAction` 直接打印警告，后续 action 失败会产生：

```text
Warning...
{"ok":false,...}
```

这会使 stderr 无法作为单个 JSON 文档解析。

## 新旧参数共同出现

值相同时保持兼容：

```bash
notes list --output json --format json
```

值不同时返回稳定错误：

```bash
notes list --output json --format table
```

```json
{
  "error": {
    "code": "CONFLICTING_OPTIONS",
    "details": {
      "options": ["output", "format"]
    }
  }
}
```

不能依赖“后出现的参数覆盖前一个参数”，因为这会隐藏调用方配置错误。

## 兼容性测试

本课将以下行为固化为集成测试：

1. `--output json` 保持正常。
2. `--format json` 继续正常工作。
3. 新旧参数值相同时可以共存。
4. 新旧参数值冲突时返回 `CONFLICTING_OPTIONS`。
5. 旧参数不出现在 `--help`。
6. 人类成功模式显示弃用警告。
7. 机器模式不混入警告文本。
8. 失败调用的 stderr 仍是单个 JSON 文档。
9. `apiVersion` 保持 `notes.cli/v1`。
10. capabilities 发布结构化弃用元数据。

测试使用字段匹配而不是整个 Envelope 快照，避免 `requestId` 和未来的兼容新增字段造成无意义失败。

## 删除旧接口的条件

删除 `--format` 至少需要：

```text
已发布替代接口
已公开弃用元数据
已给出 removalVersion
已跨越承诺的 major version
迁移文档和测试已更新
```

删除后应同步移除隐藏参数、弃用元数据和旧接口兼容测试。

## 本课结论

1. CLI 命令、默认值、输出、退出码和副作用都是公共契约。
2. CLI 版本和机器协议版本必须独立管理。
3. 弃用需要替代项、删除版本和过渡窗口。
4. 旧接口可以隐藏，但不能在过渡期停止解析。
5. Agent 通过结构化 capabilities 发现弃用。
6. 人类警告不能污染机器输出和结构化错误。
7. 新旧参数冲突必须明确失败。
8. 兼容性必须由自动化测试持续保护。
