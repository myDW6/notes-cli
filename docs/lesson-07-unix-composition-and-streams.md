# 第七课：Unix 可组合性与标准流

## 课程目标

让 CLI 能可靠参与管道、重定向和脚本组合，并保持 stdout、stderr 与退出码的明确边界。

## 标准流职责

```text
stdin   输入数据
stdout  业务结果或显式原始导出内容
stderr  错误与诊断
```

机器输出不能混入进度、成功提示或颜色，否则下游程序无法稳定解析。

## 显式标准流标记

`-` 是标准流的通用约定，但必须由调用者显式指定：

```bash
notes create --input -
notes batch --input-jsonl -
notes export - --export-format json
```

stdin 不是 TTY 并不表示一定存在输入，因此 CLI 不会隐式读取 stdin。

## 原始导出 stdout

```bash
notes export - --export-format json > backup.json
notes export - --export-format json | gzip > backup.json.gz
```

此时 stdout 是导出文件本身，不包含 CLI Envelope。原始导出格式由 `--export-format` 控制。

为了避免 stdout 同时承担两种协议，`export -` 不允许与以下选项组合：

- 显式 `--output`
- `--fields`
- `--quiet`

导出到普通文件时，CLI 仍通过正常 Envelope 或人类输出报告结果。

## 字段投影

```bash
notes list --output json --fields id,title
```

`--fields` 只改变业务 `data`，不移除成功 Envelope：

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "note_1",
        "title": "A"
      }
    ],
    "page": {
      "hasMore": false
    }
  }
}
```

列表投影只作用于每个 item，分页元数据保持不变。`--fields` 与 JSONL 冲突，因为 JSONL 的每行已有独立固定协议。

## Quiet 模式

```bash
notes delete note_1 --yes --quiet
```

成功时：

```text
stdout: 空
stderr: 空
exit: 0
```

失败时仍输出结构化错误并返回非零退出码。

`--quiet` 只适用于 table 输出，与 JSON/JSONL 冲突。这样不会出现“请求 JSON 结果但又要求静默”的歧义。

## 输出格式与重定向

下面的重定向不会自动改变输出格式：

```bash
notes list > notes.txt
```

稳定的脚本应显式声明：

```bash
notes list --output json > notes.json
```

TTY 只影响交互和颜色，不应偷偷改变数据格式。

## Broken Pipe

下游程序可能提前停止读取：

```bash
notes batch ... | head -n 1
```

CLI 捕获 stdout 的 `EPIPE` 并安静退出，不展示 Node.js 内部堆栈。这表示下游主动结束消费，而不是业务失败。

程序入口使用 `process.exitCode`，而不是正常路径直接调用 `process.exit()`，让重定向或管道中的待写数据有机会完成刷新。

## Pipefail

Shell 管道通常只返回最后一个命令的退出码：

```bash
notes list --output json | jq '.data'
```

脚本应使用：

```bash
set -o pipefail
```

这属于 Shell 的管道语义，CLI 无法单独替调用者解决。

## 本课结论

1. 标准流必须职责单一，stdout 不承载诊断信息。
2. `-` 应显式表示 stdin 或原始 stdout。
3. 原始导出内容与 CLI Envelope 是两种不同协议。
4. 字段投影只修改 data，不破坏 Envelope 和分页元数据。
5. quiet 成功静默，但错误仍然可见。
6. 重定向不应隐式改变输出格式。
7. EPIPE 应作为正常管道终止边界处理。
