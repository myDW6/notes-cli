# 第二课：统一命令与参数设计

## 课程目标

设计一套一致、可预测、便于人类和 AI Agent 使用的 CLI 命令接口。

CLI 命令通常由以下部分组成：

```text
<program> <command> [argument] [options]
```

例如：

```bash
notes get note_123 --output json
```

- `notes`：程序。
- `get`：命令。
- `note_123`：位置参数。
- `--output json`：选项。

每个值应该放在哪里，应由它的语义决定，而不是开发者的个人习惯。

## 位置参数与 Option

### 适合位置参数的值

当一个值满足以下条件时，适合作为位置参数：

- 它是命令唯一且明确的操作对象。
- 几乎每次调用都必须提供。
- 值通常简短。
- 顺序自然，不容易产生歧义。

例如：

```bash
notes get <id>
notes update <id>
notes delete <id>
notes search <query>
```

`id` 是 `get`、`update` 和 `delete` 的主要操作对象，因此：

```bash
notes get abc
```

比下面的形式更自然：

```bash
notes get --id abc
```

### 适合 Option 的值

当一个值具有以下特点时，适合使用 Option：

- 它是可选配置或资源字段。
- 顺序不应该影响含义。
- 内容可能较长、为空或包含复杂文本。
- 将来可能增加更多同类字段。
- 需要通过名称明确表达含义。

例如：

```bash
notes create --title A --content B
notes list --limit 20 --sort updatedAt
```

不推荐：

```bash
notes create "Title" "Content" "tag1,tag2"
```

虽然语法上可以实现，但调用者必须记忆参数顺序，字段扩展和可选值表达也会变得困难。

## 命令对称性

同一资源的常见操作应保持一致：

```bash
notes create
notes get <id>
notes list
notes update <id>
notes delete <id>
```

对称性可以让用户根据已有经验预测其他命令的使用方式。

推荐命名规则：

- 命令使用小写动词，例如 `create`、`list`。
- Option 使用 kebab-case，例如 `--dry-run`。
- 布尔开关使用明确名称，例如 `--yes`。
- 否定开关使用 `--no-*`，例如 `--no-input`。
- 同一个概念只保留一种标准写法。

例如统一使用：

```bash
--output json
```

不应同时提供语义相同的：

```text
--format json
--output json
--json
```

## 全局 Option 与命令 Option

### 全局 Option

全局 Option 影响所有或绝大多数命令的执行方式，并且在不同命令中具有相同含义：

```text
--output table|json|jsonl
--pretty
--no-input
--color auto|always|never
--config <path>
--data-dir <path>
--verbose
```

### 命令 Option

命令 Option 只影响某个具体业务操作：

```bash
notes create --title A
notes list --limit 20
notes delete abc --yes
```

判断标准：

> 只有能合理用于几乎所有命令，并且含义保持一致的 Option，才应成为全局 Option。

`--dry-run` 虽然是通用概念，但它只对写命令有意义。它不应该出现在 `notes get --dry-run` 这样的组合中。

## 输入来源

`notes create` 可以支持四种输入方式。

### 字段 Option

```bash
notes create --title A --content B --tags cli,agent
```

适合人类和简单脚本。

### JSON 文件

```bash
notes create --input note.json
```

适合复杂内容和可复用输入。

### stdin

```bash
cat note.json | notes create --input -
```

适合 Agent 和 Unix 管道。

### 交互输入

```bash
notes create
```

只适合允许交互并连接 TTY 的场景。

## 输入合并与冲突

当结构化输入和字段 Option 同时出现时，可以采用两种策略。

### 覆盖优先级

```bash
notes create --input note.json --title Override
```

可以规定 `--title` 覆盖文件中的标题。

这种方式比较灵活，但会带来以下问题：

- 调用者需要记忆覆盖顺序。
- 最终输入不够直观。
- `null`、空字符串和未提供难以区分。
- Agent 更难判断命令最终会执行什么。

### 互斥输入

相同命令直接返回 `CONFLICTING_INPUT`：

```bash
notes create --input note.json --title Override
```

这种方式限制更多，但行为清晰、容易测试，也便于 Agent 根据错误修正调用。

notes-cli v1 选择互斥策略：

```text
字段 Options
或 --input
或交互输入
```

三种来源不能混合。

## 缺少输入时的行为

假设 `title` 是必填字段。

允许交互且连接 TTY 时：

```bash
notes create
```

CLI 可以询问标题。

禁止交互时：

```bash
notes create --no-input
notes create --output json
```

CLI 必须立即返回结构化错误：

```json
{
  "error": {
    "code": "MISSING_REQUIRED_INPUT",
    "message": "title is required",
    "details": {
      "field": "title"
    }
  }
}
```

CLI 不应静默生成标题，也不应在非交互模式下等待用户输入。

## Option 之间的语义关系

不能仅凭两个 Option 都影响数据范围，就认为它们冲突。需要分析组合后的语义是否明确。

### 互斥关系

```bash
notes list --all --cursor abc
```

在 notes-cli v1 中：

- `--all` 表示从默认起点自动遍历所有分页。
- `--cursor` 表示从指定分页位置开始。

两者对起点的描述发生冲突，因此不允许组合。

### 可以组合

```bash
notes list --limit 20 --all
```

这个组合可以明确表示：

- 每次读取 20 条。
- 自动遍历所有页面。

因此，`--limit` 和 `--all` 不冲突。

### 依赖关系

假设以后支持：

```bash
notes list --sort updatedAt --order desc
```

可以规定：

```text
--order requires --sort
```

因为脱离排序字段后，排序方向可能没有清晰含义。

### 条件必填

```bash
notes delete abc --output json
```

JSON 输出意味着非交互，CLI 无法询问确认，因此 `--yes` 在这个场景下成为必填 Option。

## 避免含义模糊的 Option

下面的命令不推荐：

```bash
notes delete abc --force
```

`--force` 可能被理解为：

- 跳过删除确认。
- 忽略资源不存在。
- 覆盖版本冲突。
- 忽略权限或其他错误。

一个 Option 应尽量只表达一种意图。跳过删除确认应使用：

```bash
notes delete abc --yes
```

如果未来需要忽略不存在，应增加独立 Option：

```bash
notes delete abc --ignore-not-found
```

## 默认值设计

好的默认值应满足：

- 安全。
- 符合常见用法。
- 不产生意外的大规模操作。
- 不阻碍 Agent 进行确定性调用。

notes-cli v1 建议：

```text
create.content = ""
create.tags = []
list.limit = 25
list.order = desc
output = table
color = auto
```

不建议：

- `list` 默认返回全部数据。
- `delete` 默认视为已确认。
- `create` 自动生成标题。

基本原则：

> 读取操作可以便利，写入操作应当明确，危险操作必须保守。

## 帮助文本也是契约

帮助文本不仅给人阅读，也可能被 Agent 用于理解命令。

不够清楚的帮助：

```text
--input <path>  input
```

更好的帮助：

```text
--input <path|->  read create request as JSON; use "-" for stdin
```

一个高质量的 `notes create --help` 应包含：

- 命令用途。
- 参数与 Option。
- 默认值。
- 输入来源。
- 冲突规则。
- 常见示例。

例如：

```text
Usage:
  notes create [options]

Create a note using field options, a JSON file, or interactive input.

Options:
  -t, --title <title>      note title
  --content <content>      note content
  --tags <tags>            comma-separated tags
  --input <path|->         read JSON input; use "-" for stdin
  --dry-run                validate and preview without writing
  --no-input               disable interactive prompts
  -h, --help               display help

Examples:
  notes create --title "CLI Design"
  notes create --input note.json
  cat note.json | notes create --input - --output json
```

## 练习结论

| 命令 | 结论 | 原因 |
|---|---|---|
| `notes get --id abc` | 不推荐 | ID 是唯一操作对象，位置参数更自然 |
| `notes create "Title" "Content"` | 不推荐 | 多个业务字段依赖顺序，扩展性较差 |
| `notes create --input note.json --tags cli` | 失败 | `--input` 与字段 Option 冲突 |
| `notes list --limit 20 --all` | 合理 | 每页 20 条并自动遍历全部分页，语义明确 |
| `notes delete abc --force` | 不推荐 | `--force` 含义模糊，应使用 `--yes` |
| `notes search "agent first" --output json` | 合理 | 查询是唯一对象，输出格式明确 |
| `notes create --title A --no-input` | 合理 | 必填标题已提供，正文可以默认为空 |
| `notes create --output json` | 失败 | JSON 模式不交互，缺少必填标题 |

## 本课结论

1. 位置参数适合唯一、明确、常用的操作对象。
2. 可选配置和资源字段适合使用具名 Option。
3. 相同资源的命令形式应保持对称。
4. 全局 Option 必须在不同命令中保持相同语义。
5. notes-cli v1 不混合结构化输入与字段 Option。
6. Option 是否冲突由组合后的语义决定。
7. 应避免 `--force` 这类承担多种含义的模糊名称。
8. 默认行为应兼顾便利性和安全性，尤其要保守处理写操作。
9. 帮助文本也是 CLI 公共契约的一部分。
