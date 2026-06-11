# notes-cli 演进路线图：五大方向与业界最佳实践

> 基于 `confluence-cli` 的设计模式，结合业界 CLI 工具的最佳实践，为 `notes-cli` 规划五个演进方向。

---

## 方向一：构建、分发与升级

### 业界最佳实践

现代 CLI 工具的构建-分发-升级链条通常采用**"单一构建源、多通道分发、自感知升级"**的模型：

```
源代码 ──构建──► 单一产物（GitHub Release）
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
      npm        Homebrew    直接下载
        │           │           │
        └───────────┴───────────┘
                    │
                    ▼
              运行时升级检查
```

| 维度 | 最佳实践 | 代表工具 |
|------|---------|---------|
| **构建** | 交叉编译多平台（Linux/macOS/Windows × amd64/arm64），生成 checksums | `gh`, `confluence-cli` |
| **分发** | GitHub Release 为主源；npm 下载预编译二进制（非从源码构建） | `confluence-cli`, `deno` |
| **安装** | 一键脚本 `curl -fsSL .../install.sh | sh`；包管理器（brew/scoop） | `rustup`, ` volta` |
| **升级** | `cli upgrade` 自升级命令；运行时版本检查提示 | `gh upgrade`, `npm` |
| **验证** | SHA-256 校验 + 签名（provenance/codesign） | `confluence-cli` |

**关键原则**：npm 包不是源码包，而是**下载器**。安装时根据平台下载对应预编译二进制，校验 SHA-256，放到 `node_modules/.bin/` 或全局目录。

### 当前状态

- ✅ npm publish `@shaodw/notes-cli`
- ❌ 无多平台预编译二进制
- ❌ 无自升级命令
- ❌ 无安装脚本
- ❌ 无版本检查提示

### 演进路径

#### Phase 1：自升级命令（立即可做）

```bash
notes upgrade           # 检查 GitHub Releases 最新版本
notes upgrade --check   # 只检查，不升级
```

实现：读取 `package.json` 的 `repository.url`，调用 GitHub API 获取 latest release，比较版本号。有更新时提示用户运行 `npm update -g @shaodw/notes-cli`。

```ts
// src/upgrade.ts
export async function checkUpgrade(currentVersion: string): Promise<{
  current: string;
  latest: string;
  needsUpdate: boolean;
  installCommand: string;
}> {
  const latest = await fetchLatestVersion();
  return {
    current: currentVersion,
    latest,
    needsUpdate: semverGt(latest, currentVersion),
    installCommand: `npm update -g @shaodw/notes-cli`,
  };
}
```

#### Phase 2：运行时版本提示（每次命令执行时）

```ts
// 在 execute() 中，非交互模式下每隔 24h 检查一次
if (!isCI && !state.gflags.noUpgradeCheck) {
  const cache = readUpgradeCache();
  if (Date.now() - cache.lastCheck > 24 * 60 * 60 * 1000) {
    const upgrade = await checkUpgrade(VERSION);
    if (upgrade.needsUpdate) {
      console.error(
        chalk.yellow(`notes-cli ${upgrade.latest} is available. `) +
        chalk.dim(`Run: ${upgrade.installCommand}`)
      );
    }
  }
}
```

**注意**：版本提示输出到 stderr，不污染 stdout。

#### Phase 3：独立二进制分发（中期）

用 `pkg` 或 `nexe` 将 Node.js + TypeScript 编译产物打包成独立可执行文件：

```bash
# 构建
npm run build                    # tsc → dist/
npx pkg dist/index.js --targets node22-linux-x64,node22-macos-x64,node22-win-x64

# 产物
notes-cli-linux-x64
notes-cli-macos-x64
notes-cli-win-x64.exe
```

**分发渠道**：
- GitHub Releases 发布二进制 + `checksums.txt`
- npm 包改为**下载器**：安装时检测平台，下载对应二进制
- Homebrew tap（`brew install shaodw/tap/notes-cli`）
- Scoop bucket（Windows）
- 安装脚本：`curl -fsSL https://raw.githubusercontent.com/myDW6/notes-cli/main/install.sh | sh`

#### Phase 4：签名与验证（远期）

- macOS: `codesign` + `notarytool`
- Windows: `signtool` + 代码签名证书
- Linux: `cosign` (Sigstore) 或 GPG
- npm provenance: `npm publish --provenance`（已在 Trusted Publishing 路线中）

---

## 方向二：用户身份鉴权

### 业界最佳实践

CLI 工具的身份鉴权不是"有没有登录"，而是一套**凭证生命周期管理**：

```
登录 ──► 存储 ──► 使用 ──► 刷新 ──► 注销
```

| 环节 | 最佳实践 | 代表工具 |
|------|---------|---------|
| **登录** | OAuth 2.0 Device Code Flow（无浏览器也能登录） | `gh auth login`, `aws configure sso` |
| **存储** | OS Keychain 优先，`0600` 权限文件 fallback | `confluence-cli`, `gh` |
| **使用** | 环境变量 > keychain > 配置文件 | `aws` (ENV > credentials > config) |
| **刷新** | 自动刷新 access token（refresh token 存 keychain） | `gh` |
| **注销** | 从 keychain 删除 + 清除本地配置 | `gh auth logout` |
| **多账户** | Profile/context 切换 | `aws --profile`, `confluence-cli --use-context` |

**安全原则（分层）**：

```
Highest ──► 环境变量（NOTES_TOKEN）  → 一次性/CI
            OS Keychain              → 默认
            配置文件（加密）          → fallback
            配置文件（明文）          → 开发/教学
Lowest ───► 无凭证                  → 匿名/本地模式
```

### 当前状态

- ❌ 无鉴权系统（纯本地工具）
- ❌ 无凭证存储
- ❌ 无多用户隔离

### 演进路径

#### Phase 1：本地数据加密（教学级鉴权）

即使无远程服务，也可以演示完整的鉴权流程。引入**数据加密密码**：

```bash
notes auth login              # 交互式设置加密密码
notes auth status             # 显示是否已登录
notes auth logout             # 删除密码（保留明文数据）
notes auth rotate-password    # 修改密码并重新加密
```

存储设计：

```json
{
  "schemaVersion": 3,
  "encrypted": true,
  "salt": "base64...",
  "notes": "base64-encrypted-ciphertext",
  "idempotency": "base64-encrypted-ciphertext"
}
```

密码用 `scrypt` 派生密钥，AES-256-GCM 加密数据。密码本身存 OS Keychain。

**教学价值**：完整演示了登录→存储→使用→注销的凭证生命周期，即使没有真实远程服务。

#### Phase 2：Profile / Context 系统（中期）

```bash
notes config init --context work    # 创建工作上下文
notes config init --context personal # 创建个人上下文
notes config use-context work       # 切换上下文
notes config get-contexts           # 列出所有上下文
```

每个 context 独立配置：
- `~/.config/notes-cli/contexts/work/config.json`
- `~/.config/notes-cli/contexts/personal/config.json`

对应 `confluence-cli` 的 `config use-context` 和 `config get-contexts`。

#### Phase 3：远程同步鉴权（远期）

如果未来添加云端同步：

```bash
notes auth login          # OAuth Device Code Flow
# 1. CLI 请求 device code
# 2. 输出 URL，用户浏览器打开授权
# 3. CLI 轮询 token endpoint
# 4. 获得 access_token + refresh_token
# 5. 存 OS Keychain，access_token 内存使用

notes sync               # 用 token 同步到云端
notes sync --pull        # 单向拉取
```

---

## 方向三：渐进式命令发现框架

### 业界最佳实践

CLI 发现框架的目标：**让新用户不需要读文档就能学会使用工具**。业界有三种层次：

| 层次 | 机制 | 代表工具 |
|------|------|---------|
| **L1 静态帮助** | `--help`, `man page` | 所有 CLI |
| **L2 动态发现** | `capabilities`, `schema`, `explain` | `confluence-cli`, `stripe` |
| **L3 交互引导** | 向导、模糊匹配、上下文提示 | `gh`, `npm init` |
| **L4 智能推荐** | 基于历史行为推荐命令 | `fish shell`, `zsh-autosuggestions` |

**渐进式发现的核心原则**：
- 用户输入越少，系统给的引导越多
- 用户输入越精确，系统越不打扰
- 每一步都有"下一步建议"

### 当前状态

- ✅ L1: `--help`
- ✅ L2: `capabilities`, `schema create`
- ⚠️ L2: 无 `explain` 命令
- ❌ L3: 无交互引导
- ❌ L3: 无 Shell 补全
- ❌ L4: 无智能推荐

### 演进路径

#### Phase 1：Shell 补全（立即可做）

Commander 原生支持生成补全脚本：

```bash
notes completion bash   # 输出 bash 补全脚本
notes completion zsh    # 输出 zsh 补全脚本
notes completion fish   # 输出 fish 补全脚本

# 安装
notes completion bash | sudo tee /etc/bash_completion.d/notes
```

进阶：动态补全（需要与 Shell 交互）：
- `notes get <TAB>` → 补全已有 note ID
- `notes list --limit <TAB>` → 无补全（自由输入）
- `notes create --output <TAB>` → 补全 `json|jsonl|table`

#### Phase 2：模糊匹配与纠错（立即可做）

```bash
$ notes creat
Did you mean: notes create?

$ notes get abc
Note "abc" not found.
Did you mean: notes get abc123? (similar ID)
```

实现：在 `NOTE_NOT_FOUND` 错误中增加 fuzzy match 逻辑：

```ts
function suggestSimilarId(input: string, candidates: string[]): string | undefined {
  // Levenshtein distance or prefix match
  return candidates.find(c => c.startsWith(input) || levenshtein(c, input) <= 2);
}
```

#### Phase 3：`explain` 命令（中期）

```bash
notes explain create      # 详细解释 create 命令的用法、schema、示例
notes explain "idempotency"  # 解释概念
notes explain --example   # 输出可执行的示例命令
```

对应 `kubectl explain pod` 和 `confluence-cli` 的 Skill references。

#### Phase 4：交互式引导向导（中期）

```bash
$ notes
You haven't created any notes yet.

What would you like to do?
  > Create a new note
    List existing notes
    Search notes
    Configure settings
```

用 `@inquirer/prompts` 的 `select` 实现，当用户输入不完整时触发。

对应 `gh` 的交互式体验：`gh repo create` 无参数时会引导用户选择 owner、模板、可见性等。

#### Phase 5：上下文感知推荐（远期）

基于命令历史推荐下一步：

```bash
$ notes create --title "Meeting notes"
Created note: mtg_abc123

Next: notes get mtg_abc123 | notes update mtg_abc123 --content "..." | notes list
```

---

## 方向四：报错修正路径指引框架

### 业界最佳实践

错误处理不是"输出错误信息"，而是**"输出可执行的错误恢复路径"**。业界最好的错误框架满足：

```
错误 = 诊断 + 原因 + 修复步骤 + 示例命令
```

| 维度 | 最佳实践 | 代表 |
|------|---------|------|
| **结构化** | JSON 错误 envelope，机器可解析 | `confluence-cli`, Google API |
| **可恢复** | `nextSteps` 包含可直接执行的命令 | `confluence-cli` |
| **可纠错** | 模糊匹配建议正确命令/ID | Git "Did you mean?" |
| **可诊断** | `doctor` 命令自检环境 | `confluence-cli doctor`, `brew doctor` |
| **可追踪** | `requestId` 关联日志 | `confluence-cli` |
| **可解释** | 错误码有对应文档 URL | Stripe API |

### 当前状态

- ✅ 结构化错误 envelope（category, code, message, nextSteps）
- ✅ exit code 映射
- ✅ requestId
- ⚠️ `nextSteps` 有时为空数组
- ❌ 无 `doctor` 命令
- ❌ 无模糊匹配纠错
- ❌ 无错误码文档链接

### 演进路径

#### Phase 1：`doctor` 自检命令（立即可做）

```bash
$ notes doctor
✓ Configuration file exists
✓ Data directory writable
✓ Notes storage format: v2
✓ Node.js version: 22.5.1
✓ notes-cli version: 1.0.2 (latest)

Suggestions:
  - Run "notes config init" to update settings
```

对应 `confluence-cli doctor`：
- 检查配置文件是否存在且可解析
- 检查 dataDir 是否可读写
- 检查存储格式版本
- 检查是否有更新版本
- 输出诊断结果 + 建议

#### Phase 2：错误修正路径增强（立即可做）

为每个错误补全 `nextSteps` 和 `hint`：

```ts
// 当前
new CLIError('not_found', 'NOTE_NOT_FOUND', `Note "${id}" not found`);

// 增强后
new CLIError(
  'not_found',
  'NOTE_NOT_FOUND',
  `Note "${id}" not found`,
  'The note may have been deleted or the ID may be incorrect.',
  [
    'notes list --output json',
    `notes search "${id.slice(0, 5)}" --output json`,
  ],
  { id, suggestions: similarIds },
);
```

#### Phase 3：错误码文档化（中期）

为每个错误码建立文档：

```json
{
  "error": {
    "code": "NOTE_NOT_FOUND",
    "message": "Note \"abc\" not found",
    "docsUrl": "https://github.com/myDW6/notes-cli/blob/main/docs/errors/NOTE_NOT_FOUND.md"
  }
}
```

对应 Stripe 的 `code` + `doc_url` 模式。

#### Phase 4：交互式错误恢复（中期）

当 TTY 环境下遇到可恢复错误时，提供交互式修复：

```bash
$ notes delete abc
Error: Note "abc" not found

Did you mean one of these?
  1) abc123 - "Meeting notes"
  2) abc456 - "Project plan"
  3) Cancel

Select: _
```

对应 `gh` 的交互式错误恢复。

---

## 方向五：Skill 安装维护方式

### 业界最佳实践

Skill（也叫 "system prompt"、"tool instruction"）是教 AI Agent 如何使用 CLI 的文档。业界有两种模式：

| 模式 | 代表 | 特点 |
|------|------|------|
| **嵌入式** | `confluence-cli` | Skill 打包在二进制内，随版本更新 |
| **仓库式** | `npx skills` | Skill 存在 git 仓库，独立管理版本 |
| **协议式** | MCP (Model Context Protocol) | 标准化协议，Agent 动态发现能力 |

**`confluence-cli` 的 Skill 体系**：

```
skills/confluence/SKILL.md          # 主文件（YAML frontmatter + 指令）
skills/confluence/references/       # 参考文档
  ├── getting-started.md
  ├── reading-pages.md
  ├── searching-cql.md
  └── ...
```

安装：
```bash
confluence-cli skill install              # 自动探测 Claude Code / Codex
confluence-cli skill install --agent codex # 指定 Agent
confluence-cli skill show                  # 打印 embedded Skill
```

### 当前状态

- ❌ 无 Skill 系统
- ❌ 无 Agent 适配

### 演进路径

#### Phase 1：创建 Skill 内容（立即可做）

```
skills/notes/SKILL.md
skills/notes/references/
  ├── getting-started.md
  ├── commands.md
  ├── safety-modes.md
  └── errors.md
```

`SKILL.md` 结构：

```yaml
---
name: notes
description: A CLI for managing local notes with structured output, dry-run support, and idempotent operations.
version: 1.0.0
---

# notes-cli Skill

## Core Rules

1. Always use `--output json` for machine-readable results.
2. Always use `--no-input` in non-interactive environments.
3. Use `--dry-run` before destructive operations.
4. Provide `--idempotency-key` for important write operations.

## Command Reference

```

#### Phase 2：`notes skill` 命令（立即可做）

```bash
notes skill show              # 打印 SKILL.md 到 stdout
notes skill install           # 安装到 Agent 技能目录
notes skill install --agent claude-code
notes skill path              # 显示安装路径和状态
notes skill uninstall         # 卸载
```

安装逻辑（参考 `confluence-cli`）：

```ts
// src/skill.ts
const AGENT_PATHS = {
  'claude-code': {
    global: '~/.claude/skills/notes',
    project: './.claude/skills/notes',
  },
  codex: {
    global: '~/.codex/skills/notes',
    project: './.agents/skills/notes',
  },
};

export async function installSkill(agent?: string, project = false): Promise<void> {
  const targets = agent
    ? [AGENT_PATHS[agent]]
    : Object.values(AGENT_PATHS).filter(p => detectAgent(p));
  // 复制 SKILL.md + references 到目标目录
}
```

#### Phase 3：Skill 版本与 CLI 版本同步（中期）

每次发布新版本时，Skill 中的 `version` 字段同步更新。`notes skill show` 输出当前 CLI 版本对应的 Skill，避免 Agent 使用过时指令。

#### Phase 4：MCP 协议适配（远期）

Model Context Protocol 是 Anthropic 推出的标准化协议，让 Agent 动态发现工具能力：

```json
{
  "name": "notes-cli",
  "tools": [
    {
      "name": "notes_create",
      "description": "Create a note",
      "inputSchema": { "$ref": "notes.cli/v1/create-input" }
    }
  ]
}
```

如果未来 Agent 生态向 MCP 迁移，可以提供一个 `notes mcp` 子命令输出 MCP manifest。

---

## 总结：优先级矩阵

| 方向 | Phase 1 | Phase 2 | Phase 3 | 难度 | 价值 |
|------|---------|---------|---------|------|------|
| **构建分发升级** | `upgrade` 命令 | 版本提示 | 独立二进制 | 中 | 中 |
| **用户身份鉴权** | 数据加密密码 | Profile 系统 | OAuth 同步 | 高 | 高 |
| **渐进式命令发现** | Shell 补全 | 模糊匹配 | 交互引导 | 低 | 高 |
| **报错修正路径** | `doctor` 命令 | 增强 nextSteps | 交互恢复 | 低 | 高 |
| **Skill 安装维护** | Skill 内容 + 命令 | 版本同步 | MCP 适配 | 低 | 高 |

**推荐启动顺序**：
1. **Skill 系统**（教学价值最高，立即展示 Agent 集成能力）
2. **Shell 补全 + `doctor`**（用户体验提升最直接）
3. **模糊匹配 + 增强 nextSteps**（错误体验升级）
4. **`upgrade` 命令**（分发闭环）
5. **鉴权系统**（如果计划添加远程同步功能）
