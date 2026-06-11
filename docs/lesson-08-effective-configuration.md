# 第八课：配置优先级与可解释执行

## 课程目标

把参数、环境变量、配置文件和默认值集中解析为一份有效配置，并让人类与 Agent 能检查每个最终值的来源。

## 为什么配置也是契约

同一个配置值可能来自多个位置：

```text
命令行参数 > 环境变量 > 配置文件 > 内置默认值
```

如果命令各自读取环境变量或配置文件，同一次调用可能出现不同的优先级、校验和路径规则。业务命令因此不应负责寻找配置，只应消费已经解析和验证的结果。

## 不要过早设置参数默认值

下面的 Commander 定义会丢失“用户是否显式传参”的信息：

```ts
program.option('--output <format>', 'output format', 'table');
```

后续代码无法区分用户输入了 `--output table`，还是 Commander 自动填入了 `table`。正确做法是让参数层保留 `undefined`，最后再由配置解析器应用默认值。

## 有效配置模型

本课将最终值和来源绑定：

```json
{
  "value": "json",
  "source": "environment",
  "sourceName": "NOTES_FORMAT"
}
```

来源使用稳定枚举：

- `command-line`
- `environment`
- `config-file`
- `default`

`sourceName` 提供具体位置，例如 `--data-dir`、`NOTES_FORMAT` 或 `config.json#pageSize`。

## 可解释配置命令

```bash
notes config effective --output json
```

返回正常的成功 Envelope：

```json
{
  "ok": true,
  "command": "config.effective",
  "data": {
    "configFile": "/home/user/.config/notes-cli/config.json",
    "values": {
      "output": {
        "value": "json",
        "source": "command-line",
        "sourceName": "--output"
      }
    }
  }
}
```

这个命令让 Agent 不必读取帮助文本、猜测 Shell 环境或自行复刻优先级算法。

## 缺失与错误必须区分

配置文件不存在时，可以继续使用默认值。

配置文件存在但有以下问题时，必须失败：

- JSON 语法损坏
- 字段名称未知
- 字段类型错误
- 数值超出允许范围

同样，`NOTES_FORMAT=xml` 不能被静默忽略。环境变量已经明确表达了调用者意图，回退到默认值会掩盖部署错误。

能力发现命令是例外。`capabilities` 和 `schema` 不依赖业务配置，因此即使配置损坏也应保持可用，帮助 Agent 发现修复方式。

## 路径解析规则

相对路径必须有稳定的基准：

- `--config`：相对于当前工作目录
- `--data-dir`：相对于当前工作目录
- `NOTES_DATA_DIR`：相对于当前工作目录
- 配置文件中的 `dataDir`：相对于配置文件目录

解析后的有效配置只暴露绝对路径，避免 Agent 在不同工作目录中得到意外结果。

## 敏感信息边界

当前项目还没有 Token，但诊断接口必须预先确立规则：

```json
{
  "token": {
    "value": "<redacted>",
    "configured": true
  }
}
```

不能输出 Token 的开头、结尾或部分字符。有效配置的公开序列化层应成为未来统一脱敏的位置。

## 本课代码结构

```text
commands.ts
  收集显式参数，调用配置解析器

config.ts
  读取、校验、合并、解析路径、记录来源

业务命令
  只使用 config.dataDir / config.output / config.pageSize
```

配置优先级和字段校验通过单元测试验证，CLI 测试验证 Envelope、退出码以及 stdout/stderr 边界。

## 本课结论

1. 参数层应保留“未提供”状态，不应过早应用默认值。
2. 所有配置来源必须集中合并和校验。
3. 非法配置不能静默回退。
4. 有效配置不仅包含值，还包含来源。
5. 相对路径必须按来源使用明确基准并转换为绝对路径。
6. 缺失配置和损坏配置是不同状态。
7. Agent 应能通过稳定命令解释一次执行使用的配置。
8. 诊断接口必须承担敏感值脱敏职责。
