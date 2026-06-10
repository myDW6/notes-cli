# 第一课：CLI 契约与运行模式

## 课程目标

把 CLI 当作一个稳定接口，而不是若干可以执行的脚本。

一个完整的 CLI 契约包含四个部分：

```text
输入契约 + 输出契约 + 错误契约 + 行为契约
```

- 输入契约：参数、选项、文件和 stdin 如何提供数据。
- 输出契约：成功结果采用什么格式，stdout 中允许出现什么。
- 错误契约：错误码、错误信息和退出码如何表达失败。
- 行为契约：命令是否交互、是否写入数据、是否可以安全重试。

命令一旦被脚本或 AI Agent 使用，这些行为就构成了需要保持兼容的公共接口。

## CLI v1 基本原则

### 人类体验与机器协议共用一套命令

Agent First 不意味着为 Agent 设计另一套命令。相同命令应当同时支持：

- 面向人的交互式体验。
- 面向脚本和 Agent 的确定性非交互协议。

```bash
# 人类使用
notes create

# Agent 使用
notes create \
  --title "CLI Design" \
  --content "Study contracts" \
  --output json \
  --no-input
```

### 显式参数保证确定性

自动检测只用于改善默认体验。脚本和 Agent 应通过显式参数声明需求：

```text
--output table|json|jsonl
--no-input
--interactive
--color auto|always|never
```

推荐的判断优先级：

```text
显式参数 > 输出格式 > TTY 检测 > 默认行为
```

## 不要使用单一的 machineMode

“是否由机器调用”无法被可靠检测，而且不同能力之间并不完全绑定。

内部应分别描述交互、输出和颜色能力：

```ts
interface ExecutionMode {
  interactive: boolean;
  output: 'table' | 'json' | 'jsonl';
  color: boolean;
}
```

这样可以准确表达以下场景：

- 人在终端中要求 JSON 输出。
- 人将表格输出重定向到文件。
- Agent 没有 TTY，但没有提供 stdin 数据。
- 人显式要求进入交互模式。

## TTY 检测的作用与限制

Node.js 提供：

```ts
process.stdin.isTTY
process.stdout.isTTY
process.stderr.isTTY
```

常见情况：

| 场景 | stdin TTY | stdout TTY |
|---|---:|---:|
| 直接在终端执行 | 是 | 是 |
| 管道输入 | 否 | 可能是 |
| 输出重定向到文件 | 是 | 否 |
| Agent 或脚本执行 | 通常否 | 通常否 |

TTY 只能说明进程是否连接终端，不能证明调用者是人还是 Agent。因此，TTY 适合作为默认值依据，不适合作为稳定协议。

不应根据以下信息判断机器模式：

- `CI=true`
- `TERM=dumb`
- 特定 Agent 环境变量
- 父进程名称

这些信号覆盖不完整，也不够稳定。

## 推荐的运行模式规则

### 交互规则

```ts
function resolveInteractive(options: {
  noInput?: boolean;
  interactive?: boolean;
  output: 'table' | 'json' | 'jsonl';
}): boolean {
  if (options.noInput) return false;

  if (options.interactive) {
    if (!process.stdin.isTTY) {
      throw new CLIError(
        'usage',
        'TTY_REQUIRED',
        '--interactive requires a terminal',
      );
    }
    return true;
  }

  if (options.output !== 'table') return false;

  return process.stdin.isTTY === true;
}
```

对应的行为是：

1. `--no-input` 永远禁止交互。
2. `--interactive` 明确要求交互，没有 TTY 时失败。
3. JSON 和 JSONL 输出默认禁止交互。
4. 没有显式要求时，才根据 stdin TTY 决定。

### 颜色规则

机器可读输出永远不应包含 ANSI 颜色：

```ts
const color =
  output === 'table' &&
  process.stdout.isTTY === true &&
  !process.env.NO_COLOR;
```

### stdin 读取规则

stdin 不是 TTY，不代表 stdin 中一定存在数据。不能看到非 TTY 就直接读取到 EOF，否则命令可能一直等待。

只在用户明确指定时读取 stdin：

```bash
notes create --input -
```

## 代表性命令契约

### `notes create`

建议支持：

```text
-t, --title <title>
--content <content>
--tags <tag...>
--input <path|->
--dry-run
--no-input
```

输入来源：

```bash
notes create --title A --content B
notes create --input note.json
cat note.json | notes create --input -
```

v1 决定：

- `title` 必填，去除首尾空格后不能为空。
- `content` 可选，默认空字符串。
- `tags` 可选，默认空数组。
- `--input` 不能与 `--title`、`--content`、`--tags` 混用。
- TTY 环境中缺少标题时可以询问。
- `--no-input` 或 JSON 输出时缺少标题必须立即失败。
- `--dry-run` 只验证和规范化输入，不写入数据。

### `notes list`

建议支持：

```text
--limit <number>
--cursor <cursor>
--all
--tag <tag>
--sort <field>
--order asc|desc
```

v1 决定：

- `limit` 必须是 1 到 1000 之间的整数。
- `--all` 与 `--cursor` 不能同时使用。
- cursor 是不透明字符串，调用者不应解析其内容。
- 空列表是成功结果，退出码为 `0`。
- JSON 输出使用包含分页信息的 envelope。

### `notes delete <id>`

建议支持：

```text
--yes
--dry-run
```

v1 决定：

- 人类交互模式下，缺少 `--yes` 时询问确认。
- 非交互模式下，缺少 `--yes` 时返回 `CONFIRMATION_REQUIRED`。
- `--dry-run` 不需要确认，也不执行删除。
- 默认情况下，删除不存在的 Note 返回 `NOTE_NOT_FOUND`。
- 不使用含义模糊的 `--force` 同时表达确认和忽略错误。

## stdout 与 stderr

机器模式必须遵守：

- stdout 只包含命令结果。
- stderr 只包含诊断信息。
- JSON 输出不能混入颜色、成功符号或提示文字。

以下输出不适合作为机器协议：

```text
✓ Note created: abc123
{"id":"abc123"}
```

因为整个 stdout 不是合法 JSON。

## 错误码与退出码

两者职责不同：

- 错误码用于程序精确判断失败原因。
- 退出码用于 Shell 粗粒度判断失败类别。

建议的退出码：

| Exit code | 含义 |
|---:|---|
| `0` | 成功 |
| `1` | 内部错误 |
| `2` | 用法或参数错误 |
| `3` | 配置错误 |
| `5` | 权限错误 |
| `6` | 资源不存在 |
| `11` | 冲突 |

例如：

```text
错误码：MISSING_REQUIRED_INPUT
错误类别：usage
退出码：2
```

Agent 应读取结构化错误码，简单 Shell 脚本可以只判断退出码。

## 示例判断

| 命令 | 预期行为 |
|---|---|
| `notes create` | TTY 下交互 |
| `notes create --title A --output json` | 成功，正文默认为空 |
| `notes create --title A --no-input` | 成功 |
| `notes create --input note.json --title B` | 失败，输入来源冲突 |
| `notes list --limit abc` | 失败，参数无效 |
| `notes list --all --cursor xyz` | 失败，参数冲突 |
| `notes delete abc` | 人类模式下交互确认 |
| `notes delete abc --output json` | 失败，机器模式缺少 `--yes` |
| `notes delete abc --dry-run --output json` | 成功，不确认、不删除 |

## 本课结论

1. CLI 是需要维护兼容性的公共接口。
2. Agent First 的核心是确定性，而不只是支持 JSON。
3. 不应猜测调用者身份，应分别解析交互、输出和颜色能力。
4. 显式参数决定协议，TTY 只提供友好的默认行为。
5. 机器模式必须无隐式交互、无 stdout 污染、无隐式副作用。
6. 输入冲突和无效参数应立即返回稳定、结构化的错误。
7. `dry-run`、危险操作确认和明确的 stdin 读取规则，是 Agent 安全调用 CLI 的基础。
