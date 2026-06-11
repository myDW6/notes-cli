# 第四课：能力发现与 JSON Schema

## 课程目标

让 Agent 不依赖 README 或自然语言帮助，就能发现 CLI 支持的操作，并构造合法的结构化输入。

## 两层发现机制

```bash
notes capabilities --output json
notes schema create --output json
```

- `capabilities` 描述 CLI 能做什么。
- `schema create` 描述 `notes create --input` 接受什么数据。

两者都使用统一的成功 Envelope，因此 Agent 可以复用已有解析逻辑。

## 具体能力而不是主观标签

能力清单使用可执行、可验证的字段：

```json
{
  "readOnly": false,
  "destructive": true,
  "requiresConfirmation": true,
  "supportsDryRun": true,
  "supportsStructuredInput": false
}
```

不使用 `agentFriendly`、`safe`、`powerful` 等无法指导程序行为的主观描述。

## Create Input Schema

`notes schema create --output json` 返回 JSON Schema Draft 2020-12：

```json
{
  "$id": "notes.cli/v1/create-input",
  "type": "object",
  "additionalProperties": false,
  "required": ["title"],
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1
    },
    "content": {
      "type": "string",
      "default": ""
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "default": []
    }
  }
}
```

Schema ID 与机器协议版本绑定，而不是与 npm 包版本绑定。

## 拒绝未知字段

下面的输入包含拼写错误：

```json
{
  "title": "A",
  "contents": "Body"
}
```

CLI 返回 `UNKNOWN_INPUT_FIELD`，而不是静默忽略：

```json
{
  "error": {
    "code": "UNKNOWN_INPUT_FIELD",
    "details": {
      "field": "contents",
      "allowedFields": ["title", "content", "tags"]
    }
  }
}
```

对于机器输入，明确失败比宽容忽略更安全。

## 单一事实来源

项目中的 `CREATE_NOTE_INPUT_SCHEMA` 同时用于：

- `schema create` 的输出。
- create 输入字段白名单。
- 字段类型和最小长度校验。
- `content` 与 `tags` 的默认值。
- capabilities 中的 `inputSchema` 引用。

这样可以降低 Schema 文档与运行时行为发生漂移的风险。

当前没有引入大型 Schema 验证库，而是使用共享 Schema 常量和契约测试控制范围。随着 Schema 复杂度增加，可以再评估 Ajv 等标准验证器。

## Agent 工作流

```text
1. 调用 capabilities 发现 create 支持结构化输入和 dry-run
2. 调用 schema create 获取准确输入结构
3. 根据 Schema 构造请求
4. 使用 dry-run 验证规范化输入
5. 正式执行 create
```

## 本课结论

1. `--help` 适合人类，但不是严格机器契约。
2. 能力发现应描述具体事实，而不是主观评价。
3. JSON Schema 应表达类型、必填字段、默认值和未知字段策略。
4. Schema 和运行时校验必须保持一致。
5. 未知机器输入应明确失败，避免成功执行错误请求。
6. 发现命令也应复用统一 Envelope 和协议版本。
