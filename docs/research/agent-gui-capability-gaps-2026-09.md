# 成熟 Agent GUI 对照：Rei 下一步应该补什么

研究日期：2026-09-05。结论针对实际源码，而不是旧版截图或产品愿景。仅调研；没有实现、提交、发布或修改其他文件。

## 结论先行

**Rei 已经不是“只有聊天框的壳”。下一阶段最缺的不是更多面板，而是把 agent 的工作变成可以检查、介入、恢复和再次找到的闭环。**

最值得先做的五件事：

1. **P0：仓库变更审阅，以及有明确范围和风险说明的恢复入口。** 先看清改了什么，再谈一键撤销。
2. **P0：让子 agent、后台任务和待批准事项真正可见。** 现有核心能执行，但桌面订阅与导航没有完整接上。
3. **P1：文件路径可打开、可定位、可作为精确上下文引用。** 不做完整 IDE，也应让“这段代码”有一个可操作的对象。
4. **P1：MCP 连接管理，而非只展示工具目录。** 已连接、失败、重连、作用域、授权，是能力真正可用的前提。
5. **P1：会话检索、置顶/归档、最近项目入口。** 当前有搜索，但只是有限列表上的标题/目录匹配，不是历史检索。

之后再做隔离 worktree 工作流、预览验证反馈、上下文用量透明度。不要先造多 agent 卡片仪表盘、完整编辑器或云端自治平台。

## 1. 方法、版本与证据边界

### 本地基线

- **Rei：`5bbd8db333519f6a9238c2cffb1bda64bc71b94f`**，实际入口是 `src/main/index.ts` → `src/main/desktop/*` → `src/renderer/src/App.tsx`。
- **当前对接核心：`bingo-improve`，`4dc5917877f589e439d519c5f68e7e3ca6bdd7af`，tag `v0.5.1`。** 此值由本次 `git rev-parse` / `git describe` 实读获得，比任务开头给出的版本更新。本文中的“bingo”指产品权威层；当前源码位于该 worktree，不拿旧 `bingo/` 的实现推断能力。
- `Rei/src/shared/rpc.ts:1–3` 标明从 `bingo-improve/schema/rpc.json` 生成，protocol 为 1。本次同时阅读原 schema、SDK、插件实现，而非仅凭生成类型推断功能已落地。
- 调研期间其他工作正在发布；核心存在已暂存的 browser/ADR 改动，Rei 也有先前未跟踪的研究和图片。均未修改，亦不把尚未提交的发布工作判定成已发布功能。
- 本报告与已有 `claude-codex-app-ui.md` 侧重点不同：后者是视觉方向，本报告是**能力缺口与工程工作流**。

### 外部取样

阅读 **16 个成功返回的官方页面**，其中 15 个能力正文、1 个 OpenAI 旧入口迁移后的导航页。覆盖 OpenAI Codex、Claude Desktop Code/Cowork、Cursor、Windsurf/Cascade。来源集中列在文末；没有使用二手功能宣传或价格猜测。

需要特别注意：

- **Codex 文档迁移**：旧 `developers.openai.com/codex/app/features` 当前返回 ChatGPT 工作流导航；可读正文在 `learn.chatgpt.com/codex/*`，正文多称 **ChatGPT desktop app 中的 Codex**。本文的“Codex app”沿用用户称呼，不声称所有功能都存在于历史独立安装包。[O0][O1]
- **Claude**：以 Code tab 为工程对照；Cowork 单列。当前 Cowork 文档描述 cloud beta，同时保留 local session 注意事项，不能把旧版“必须开着电脑”和新版云任务混在一起。[A1][A2]
- **Cursor**：不是仅比较传统编辑器侧栏；当前官方已有 **Agents Window**，且与 IDE、CLI 的功能范围不完全相同。[C5]
- **Windsurf**：官方 `docs.windsurf.com/windsurf/cascade/*` 页面当前使用 **Devin Desktop / Cascade** 名称；本文记录该官方文档中的功能，不推断历史 Windsurf 客户端自动获得全部更新。部分页面内链迁往 `/desktop/` 但返回 404，故引用实际可读的旧路径。[W1–W3]
- 平台、套餐、组织策略和逐步上线可能影响可用性。本次没有安装/登录四款竞品实测；**文档证据不等于各平台设备验收**。Cursor checkpoints 路径返回 404，不据此宣称 Cursor 没有或一定具有某种恢复语义。

## 2. Rei 已有的能力：这些不应重新列为缺失

以下均为源码确认，非本次运行验收。

| 能力 | 当前实现与范围 |
|---|---|
| 独立桌面工作区、可选项目 | Electron 主进程；无项目时可用 private scratch cwd；并非必须先选仓库。`App.tsx:55–56,159`，`Settings.tsx:41–51` |
| 双语与桌面偏好 | en/zh-CN、system/light/dark、启动过渡、reduced motion；本轮不应再把本地化和基础主题列为新功能 |
| 模型与权限 | 自定义模型/effort picker；`default / acceptEdits / plan / dontAsk / bypassPermissions`；危险模式二次确认。`Composer.tsx:19–25,60–65`，`App.tsx:167` |
| 对话和历史 | 流式正文/思考、工具展开、历史分页、恢复会话、重命名、删除、Markdown 导出；导出明确提示只包含已加载历史。`App.tsx:127–130,146,166`，`Timeline.tsx:14–35,57–61` |
| 输入便利性 | 图片附件、文本草稿持久化、slash 命令补全、运行中追加消息和队列预览；不是“没有排队能力”。`Composer.tsx:28–65` |
| 审批与问答 | permission、单/多选问题、表单、confirm、登录交互；单次/会话允许和拒绝。权限请求可展示 diff，但不等于完整变更审阅。`InteractionPanel.tsx:23–55` |
| 设置与连接模型 | Provider 状态、浏览器登录、添加 OpenAI/Anthropic-compatible API provider；凭据不走聊天日志。Tools/Skills/Commands/Plugins 目录发现。`Settings.tsx:31–35`，`runtime.ts:42–47` |
| 浏览器与终端 | 右侧内嵌浏览器、底部真实 PTY；ShowPage 可自动在内嵌浏览器打开。**都已存在**。`App.tsx:146,161`，`agent-browser.ts:3–32` |
| 搜索、快捷键、用量 | ⌘/Ctrl K 搜索标题/目录和命令；N、B、L、逗号等快捷键；详情里已显示输入/输出 tokens 和 context used/window。`App.tsx:87–98,152,165` |
| 故障与生命周期 | 断线/重同步、重连提示、退出/切项目时停止任务确认；macOS 关窗隐藏应用。不是毫无后台行为。`main/index.ts:53–65,103–123` |
| 安全边界 | Renderer sandbox、context isolation、typed preload；外部浏览器无 preload，权限默认拒绝；外部图片不自动加载。**这是 Electron 边界，不是 agent shell 的 OS sandbox。** |

## 3. 四款产品各自真正值得借鉴什么

| 产品 | 官方可确认的关键工作流 | 对 Rei 的判断 |
|---|---|---|
| **Codex app / Codex 视图** | Git review pane 支持 unstaged/staged/branch/last-turn 等范围、行评论、按 file/hunk stage 或 revert；worktree 创建、handoff、清理/恢复；项目与聊天 pin/archive/search；完成/权限/问题通知；命令 OS sandbox。[O1–O5] | 最值得学的是 **变更对象 + 任务环境 + 注意力管理**，不是把项目和会话包装成仪表盘。其 review pane 明确含用户及其他工具的未提交改动，值得借鉴这种诚实的来源说明。 |
| **Claude Desktop Code** | 文件 @mention 与附件、diff 行反馈、Review code、可组合 file/browser/terminal/plan/tasks/subagent pane；并行 session/worktree；自动预览验证、dev server 配置与日志；连接器/插件设置；完成通知与 usage ring。[A1] | 与 Rei“同一核心的薄桌面端”最接近。应优先借鉴 **从聊天指向代码/证据、从后台工作回到审批**。官方明确完整 Agent teams 不在 Desktop，不能把 CLI teams 当成其桌面现成功能。 |
| **Claude Cowork** | 结果导向的多步工作、项目上下文、连接器权限、插件、计划任务；当前文档的 cloud beta 支持关电脑后继续。[A2] | 借鉴 **清楚说明会做什么、需要谁批准、结果在哪里**。不值得照抄办公模板入口或把 Code/Cowork 强行拆成 Rei 的两个 agent 引擎。 |
| **Cursor** | Agents Window 跨项目/环境管理、diff/PR/worktrees，与 IDE 往返；文件搜索；Plan Mode 研究→澄清→可编辑计划→Build；@files/folders/terminal/chats/diff/browser；context 分类视图；MCP 安装、OAuth、状态与日志。[C1–C5] | 借鉴 **显式上下文引用和计划/执行交接**。不要为了对标而补齐 VS Code 的编辑、LSP、调试器和扩展生态。 |
| **Windsurf / Cascade** | Code/Chat、计划 todo、排队消息可移除/立即发送、命名 checkpoint/revert、已有会话 @mention、并行 Cascade；worktree 模式及 merge；MCP 安装、工具开关、OAuth。[W1–W3] | 借鉴 **长任务的可控连续性**。命名 checkpoint 不等于可靠隔离，自动 worktree 清理也不能无条件照搬；先保护人的未提交工作。 |

### 能力差距总览

标记：**已有**＝Rei 已有明确入口；**接线缺口**＝bingo 已有功能或命令，但 Rei 没把流程完整呈现；**产品缺口**＝需要 bingo 的插件/存储/协议补能力，不代表必须塞进 kernel。

| 工程流程 | Rei 当前状态 | 差距性质 | 优先级 |
|---|---|---|---|
| 改完→看文件清单/diff→逐行反馈 | 只有工具结果/审批 diff，无仓库级 Changes 入口 | Rei 阅读 UI + bingo 变更查询契约 | P0 |
| 回到某次请求前 | `/rewind` 可通过现有命令输入调用，事件也已折叠；没有面向人的 turn picker/安全恢复流程 | 接线缺口 + 恢复安全性产品缺口 | P0，恢复按钮晚于预检 |
| 子 agent→看进度→批准/停止 | 核心可 spawn；Rei `children:false`、普通列表隐藏 child | 接线缺口；不是“无多 agent” | P0 |
| 后台 shell/task→需要我时回来 | 队列/普通工具记录已有，实时 task/job state 未展示；无 OS notification 接线 | 接线缺口 | P0/P1，归入活动流 |
| 文件→预览/定位/@context | 图片附件已有；没有文件入口与引用补全 | Rei 入口 + 必要的上下文契约 | P1 |
| MCP 配置→连接→修复→授权 | 目录发现、`/mcp` 命令已有；无专用连接管理 | 部分接线缺口；MCP OAuth 是产品缺口 | P1 |
| 找回以前讨论 | 有 title/cwd 搜索；无正文检索、pin/archive；单 cwd list limit 500 | Rei 组织 + bingo 检索/元数据 | P1 |
| 两项工作独立改代码 | 多会话可切换但同目录；无 managed worktree 工作流 | 产品缺口 | P1 后段 |
| 先计划再执行 | 已有 `plan` 权限模式、slash、tasks 插件 | 不新造模式；任务/计划可见性交给活动流 | 暂不单列 |
| 预览→选择问题→附证据→验证 | 浏览器与 PTY 已有；没有 DOM/截图反馈和验证结果关联 | 在既有面板上补闭环 | P2 |
| 看上下文还剩多少/花在哪里 | 详情已有 tokens/context；缺就地预警、细分解释 | 部分接线；细分归因/价格是产品缺口 | P2 |
| 安装/更新/安全自治 | 有打包配置与 binary discovery；无桌面更新接线；agent shell 未见 OS sandbox | 分发与安全准入问题，见第 6 节 | 不冒充普通 UI 小功能 |

## 4. 八项建议：用户故事、所有权、代价和风险

规模是相对判断：**S**＝现有契约上的局部入口；**M**＝多状态/跨主进程接线；**L**＝新持久化/跨进程契约/文件操作语义。不是工期承诺。优先级按“错误或等待的代价 × 使用频率”，不是按竞品功能数量。

### 1）P0 — Changes 审阅闭环；恢复必须讲清楚边界

**用户故事**：agent 说“修好了”，我不想翻十次 Edit 输出；我要看到本仓库改了哪些文件、逐行指出一处不接受的改动，再决定是否恢复。

- **竞品证据**：Codex review 的多范围 diff、行评论、file/hunk 操作；Claude 的 diff stats→文件列表→行反馈。[O2][A1]
- **当前缺口**：`Content.tsx:45` 只是 `View.diff` 文本渲染；`Timeline.tsx:19` 的回复操作仅 Copy；`App.tsx:146` 会话菜单无 Changes。不能把“会画 diff”算成审阅工作流。
- **已具备的核心**：`bingo-checkpoints/src/command.rs:82–104` 注册 `/rewind`；`main.rs:676` 实际装配插件；`session.ts:211–213` 已处理 `rewound`。因此“从零造撤销引擎”是错误任务。
- **最小范围**：新增按需 Changes 视图，先只读；明确比较基线、仓库、文件列表和 binary/untracked 等状态。行反馈带 `path + line/range + revision` 回到会话。恢复入口优先面向 turn，不把 Git revert、撤回对话、恢复文件混成一个“Undo”。
- **所有权**：Rei renderer 拥有阅读/评论 UI；本地打开编辑器属于 Electron main。跨表面共享的变更范围、来源与恢复规则属于 **bingo 插件/协议**，不由 renderer 扫描聊天拼出“权威改动清单”。
- **代价**：只读审阅 **M**；安全恢复全流程 **L**，分开交付。
- **依赖/风险**：checkpoint 只跟踪 `Write/Edit`（`hook.rs:17`），不覆盖 Bash、MCP 外部副作用；超过 8 MiB 等情形可跳过。`restore.rs:93–111` 直接回写，尚无当前文件漂移比较，多文件失败也非原子事务。**直接加“安全一键撤销”会掩盖真实风险。** 先在 bingo 定义预检/冲突拒绝或明确授权范围，再做 GUI 确认；禁止自动覆盖用户后来修改的内容。
- **验收**：包含“用户原有未提交改动、agent 修改、agent 后用户又改、Bash 生成文件、部分恢复失败”五类 fixture；界面必须说清哪些能恢复、哪些未恢复，不能仅删消息后显示成功。
- **价值判断**：让人敢授权的关键不是更强自动化，而是能检查结果和保留退出路径。

### 2）P0 — 子会话与活动流：先消除不可见的等待，再做通知

**用户故事**：我把测试交给子 agent，继续看主会话；子 agent 要权限时我应能看到“谁、在哪个目录、请求什么”，批准后回到工作，不必猜为什么一直转圈。

- **竞品证据**：Claude tasks/subagent pane 和非当前会话完成通知；Codex Activity 中的 unread/running/waiting、独立的完成/权限/问题通知开关。[A1][O4]
- **当前缺口**：`useWorkspace.ts:93` 显式 `options:{children:false}`；`App.tsx:60` 普通列表排除 `parent`；`App.tsx:156` 只渲染 active snapshot 的 interactions。核心的子会话权限可能因此没有直接可见入口。**这是静态接线推导的风险，未进行真实子 agent 请求复现**；⌘K 偶然搜到 child 不是合格的审批导航。
- **已具备的核心**：SDK/RPC 有 `OpenOptions.children`；ADR-0010 §3 定义后代事件与 `root/session` 路由。tasks 在 `extensions["bingo.tasks"]["tasks"]`；background jobs 在 `signals["bingo.tools.bash"]["jobs"]`。Rei reducer 已接收 extensions/signals（`session.ts:215–221`），但应用未展示。
- **最小范围**：主会话下的 child list + 当前活跃任务/作业 + 跨会话 Needs attention 聚合；点击进入 child transcript 或对应批准项。第二步再加仅在非前台时触发的系统通知，点击定位原 session，支持关闭和去重。无需常驻任务卡片墙。
- **所有权**：**Rei 主导，M**。订阅、路由、状态呈现遵守 bingo 事件；任务/作业写入继续归现有插件。新增独立消费的任务字段必须以插件原生 schema/fixture 对表，不手写第二套持久状态。OS 通知由 Electron main 发出，renderer 不获得额外特权。
- **依赖/风险**：历史 child replay 与活跃 child 不同；重复订阅去重、重连后正确归属、后台审批超时、通知泄露敏感文本。停止主 turn 不等于自动停止所有 child：`spawn.rs:315–316` 明确前台等待被取消时 child 继续。按钮必须准确命名目标，不做假“全部停止”。
- **验收**：真实根/子会话接线测试验证批准到达正确 session；任务完成后移出 running，重新打开仍读到权威状态；另做 OS 通知权限与点击定位的设备测试，不能用 reducer 单测替代。
- **价值判断**：这是 bingo 已有能力最明显的桌面承接缺口，比“再加一个 agent 按钮”优先得多。

### 3）P1 — 文件导航与精确上下文引用，不造 IDE

**用户故事**：回复引用 `src/auth.ts:48`，我要点开看到该行；选取一个函数后发送“只改这里”，不要手抄路径或整文件塞进提示。

- **竞品证据**：Claude 路径打开、Attach as context、外部编辑器/Finder；Cursor `@Files/Folders/Terminals/Chats/Git diff/Browser` 与 Agents Window 文件搜索。[A1][C3][C5]
- **当前缺口**：`RichText` 在 `Content.tsx:26` 仅允许 HTTP(S) 链接，其余渲染成 span；工具 target 是文字（`Timeline.tsx:23–24`）。`Composer.tsx:28,40,60` 的 draft 只有 text/images、只有 slash 补全。
- **最小范围**：路径点击→轻量只读预览/外部编辑器；快速文件查找优先于永久文件树；引用可带行范围、可移除、有明确内容来源。先支持文件与终端选区，不一次照抄所有 @ 类型。
- **所有权/代价**：本地预览/打开由 **Rei main + renderer，M**；如果引用需要在发送时解析、截断、落日志，并保证不同 surface 含义一致，先在 **bingo Input/上下文边界，M** 定义。现 `Input` 只有 text/images/action，不能把新协议埋进 renderer。首步可发送人能看懂的路径引用，但不得标成“文件内容已附上”。
- **依赖/风险**：@ 已有 agent/room 语义，须区分“文件引用”和“对 agent 发话”；路径 realpath/越界、symlink、二进制/超大文件、文件发送前变化、secret 文件与预算。预览不等于授权模型读取；引用整目录不等于递归全量上传。
- **验收**：Windows 路径、带空格路径、已删除文件、超大文件、文件/agent 同名；确认 provider 最终收到的内容与可见引用相符。
- **价值判断**：这是最小的“工程对象感”；比 Monaco 编辑器、symbol index 或多标签编辑更高杠杆。

### 4）P1 — Connections：让 MCP 可管理、可诊断、可授权

**用户故事**：我添加 GitHub/内部文档服务后，知道它属于哪个项目、是否连接成功、失败原因在哪里，能重连或停用，而不是在几百个工具名中猜测。

- **竞品证据**：Claude Connectors/Customize；Cursor MCP 安装与 OAuth、server toggle 和 MCP logs；Cascade MCP 管理与工具开关。[A1][C1][W3]
- **当前缺口**：`Settings.tsx:35` 是 capabilities 的只读目录，没有连接生命周期、配置来源或服务日志入口。不能误报“没有 provider setup”：`Settings.tsx:31–33` 已有模型服务商配置。
- **已具备的核心**：`bingo-mcp/src/command.rs:26–43,158–178` 有 `/mcp` 状态、reconnect/enable/disable，可由现有 command UI 调用。`config.rs:30–40` 支持 stdio/HTTP；`dial.rs:145–157` 只是配置 headers 的 HTTP transport，未见 MCP OAuth 发现/刷新流程。**Provider OAuth 已有，不代表 MCP OAuth 已有。**
- **最小范围**：连接状态、工具数、重连、启停、脱敏诊断、查看来源。现有 `/mcp` 可作为第一阶段入口；图形化新增配置及 OAuth 后置，不先建 marketplace。
- **所有权/代价**：已有命令入口 **Rei S–M**；原生配置写入、作用域/持久化、MCP OAuth 属于 **bingo-mcp/凭据边界 M–L**；UI 不另存 `mcp_config.json`，不独立维护启用状态。当前命令发起动作并不等待握手完成，要显示 connecting 而不是立即写“已连接”。
- **依赖/风险**：配置全局/项目覆盖、重连对运行中 turn 的影响、stdio 安装即执行代码、OAuth callback 与撤权。凭据不得经 `session/answer`、`Input.text`、普通 form 或日志传输；延续已有 provider-setup 的非会话通路。
- **验收**：连接成功、失败、超时、重连、停用、生效范围、重启后状态；构造 secret 确认日志和 transcript 不包含它。
- **价值判断**：少量可用连接胜过很大的工具目录；“出了问题能修”比“能安装”更重要。

### 5）P1 — 会话检索与整理；先不承诺跨项目并行

**用户故事**：几天前修过一个登录问题，我只记得报错中的几个词；找回讨论后把它固定在项目里，已完成的工作移出日常视野但不删除。

- **竞品证据**：Codex project/chat pin、Search chats、archive/restore；Claude 按 status/project/environment 过滤与项目分组。[O1][A1]
- **当前缺口**：`App.tsx:165` 搜索 `title + cwd` 并截取 12 条；`useWorkspace.ts:72` 只列当前 cwd、limit 500；不搜索正文。`SessionSummary/SessionFilter` 未含 archive、pin、text query。`DesktopPreferences.recentWorkspaces` 已存，但 App 只有 native folder picker。
- **最小范围**：最近项目菜单、项目内状态过滤、非破坏归档/恢复、置顶、跨历史正文检索与结果定位。不要先铺标签、收藏夹、复杂文件夹层级。
- **所有权/代价**：最近项目/界面排序 **Rei S**；如果 pin 仅代表本机展示偏好可留 Rei；归档的产品语义和权威历史搜索归 **bingo session/store 插件或服务 + RPC，M**。不要在 Electron 复制整份 transcript 建第二个会话仓库。
- **依赖/风险**：正文索引失效、删除后残留、缓存隐私、长历史分页与命中定位。archive 不是 delete，也不默认删除 worktree。当前 `DesktopRuntime.connect()` 先 close；`ipc.ts:121–126` 切项目会提示停止运行工作。**加最近项目菜单不能对外叫“多项目后台同时运行”。**
- **验收**：命中不在已加载页中的消息；归档可恢复、搜索 scope 可解释、删除后不再返回；切项目仍准确提示生命周期变化。
- **价值判断**：这是长期使用的复利功能，但优先级低于审阅与等待救援。

### 6）P1 后段 — 真正隔离的 worktree 会话，先支持独立顶层任务

**用户故事**：一边修支付，一边补文档；第二项工作不碰第一项未提交文件。结束后我能打开相应 checkout 验证，再明确决定合并或保留。

- **竞品证据**：Codex worktree/Local handoff、保留和恢复；Claude 并行 session 自动 worktree；Cursor Agents Window worktree；Cascade Worktree 与 merge。[O3][A1][C5][W2]
- **当前缺口**：Rei 新会话 cwd 固定为当前连接目录，`ipc.ts:139–145` 强制 workspace 一致；核心 `SpawnArgs` 没 cwd/isolation（`spawn.rs:57–85`），child `SessionSpec.cwd = cx.cwd`（159–173）。源码中 worktree 字样主要是 context root 识别/测试，**已有 Git 工具可手工操作，不等于已有 managed isolation**。
- **最小范围**：新顶层任务可选“本地目录 / 新隔离 checkout”；显示实际 cwd/branch/base；安全创建、打开、保留、人工确认清理。先不做自动 handoff、自动 cherry-pick、多 agent 同文件裁决。
- **所有权/代价**：**bingo 的 workspace/Git 插件或服务 + 契约，L**；Rei 只负责选择、状态和 native 打开。环境创建/清理是 agent/TUI/GUI 都会消费的产品规则，不散落在 Electron 脚本。agent 子任务不同 cwd 还受 host/settings 作用域影响，不能简单加个输入参数就宣称完成。
- **依赖/风险**：依赖建议 1 的审阅、建议 2 的活动归属；脏目录、已有分支、依赖初始化、端口冲突、磁盘占用、跨仓库项目。**worktree 隔离文件，不隔离权限、网络和端口**；默认不复制 `.env`，不自动删除有价值的 checkout。
- **验收**：两个任务产生同名文件修改不互相覆盖；删除/取消不会影响主 checkout；非 Git 文件夹明确退回普通模式而不是自动 `git init`。
- **价值判断**：比“再跑更多 agent”重要，但工程量大，应在可见与可审阅之后投入。

### 7）P2 — 在已有浏览器/PTY 上补验证反馈，不重做浏览器

**用户故事**：页面渲染不对，我点选出问题的元素、附截图和相关 console/terminal 片段，agent 修完后给我与这次修改对应的验证结果。

- **竞品证据**：Claude Browser pane 自动验证、DOM/截图交互、dev server 配置/日志；Cursor @Browser/@Terminals。[A1][C3]
- **当前缺口**：`PanelBrowser.action()`（`browser.ts:37–47`）只有导航/刷新/外部打开/聚焦；`AgentBrowser` 自动打开被批准的 ShowPage，不是任意站点 DOM 控制协议。Rei 面板已经能人工预览和运行命令，缺的是**将问题与验证证据传回同一任务**。
- **最小范围**：先做截图/终端选区显式附到草稿，保留 URL、时间、cwd 与来源；给测试命令提供可复用的入口与结果链接。再按需求增加元素选择/console 采集；不能默认每次 Edit 都跑全套浏览器回归。
- **所有权/代价**：截图与选择器为 **Rei main/renderer M**；模型调用浏览器、运行/重跑测试的安全与结果契约归 **bingo 工具/插件 M–L**。独立消费边界先定类型，renderer 不获得任意 `executeJavaScript` 权限。
- **依赖/风险**：沿用 foreign content 无 preload 的边界（`browser.ts:103–108`）；需要显式授权站点/当前会话，避免误附登录数据。持久 browser partition 当前为全局 `persist:rei-browser`，扩展自动化前应决定项目隔离、清除数据与身份提示。
- **验收**：附加前可检查/删除证据；显示“未运行 / 已通过 / 失败 / 中断”的真实状态；浏览器截图不能充当编译或行为测试通过的证据。
- **价值判断**：有了审阅和上下文入口，才值得打通这一步；不是因为竞品有 browser，所以再加一次 browser。

### 8）P2 — 就地上下文预警与真实用量，不做伪精确账单

**用户故事**：长任务快到上下文阈值时我能提前知道；理解哪些是本次/全会话 tokens、哪些是缓存，决定是否压缩，而不是等报错才打开详情。

- **竞品证据**：Claude usage ring 区分 context 与 plan usage；Cursor context ring 的分类说明。[A1][C3]
- **当前缺口**：`App.tsx:152` 已显示 total input/output、used/window，但藏在详情。SDK `Usage` 已有 cacheRead/cacheWrite/reasoning；`ContextUsage` 已有 trigger。当前没有来源分类或实际货币账单字段（SDK `model.rs:317–340`、`event.rs:272–284`）。
- **最小范围**：composer 附近轻量 context 提示，展开查看权威 counters、阈值/压缩行为，直接调用已有 `/compact`；把“本 turn”和“本 session”分清。对并行 child 的统计说明是否纳入，不默默混算。
- **所有权/代价**：现有字段呈现 **Rei S**；prompt 来源分类、跨 session 汇总和真实计费取数属于 **bingo context/provider 边界 M–L**，没有可靠数据就标 unknown。不要用 GUI 的 tokenizer 另算一套 used。
- **依赖/风险**：不同 provider 的缓存和 reasoning 计数口径；订阅额度不等于 API 金额；自定义 endpoint 价格未知。不要把模型目录中的标价当已结算账单。
- **验收**：与真实 turnUsage/summary 对齐，压缩后阈值和历史计数各自保持语义；未知价格不显示 `$0.00`。
- **价值判断**：很好的小改动，但不能取代前三项真正影响工程交付的工作流。

## 5. 哪些已经在 bingo，只是没有被 Rei 好好接住

这是最容易把路线图做大的误判点。

| bingo 已有事实 | 精确证据 | Rei 应做什么 / 不应做什么 |
|---|---|---|
| Checkpoint 与 `/rewind` 已实际注册 | `crates/bingo/src/main.rs:676`；`bingo-checkpoints/src/command.rs:82–104` | 补 turn 入口及安全说明；不重造快照库、不许称全部副作用可撤销 |
| Child session + 后代事件订阅 | SDK/RPC `OpenOptions.children`，`docs/adr/0010-sub-sessions.md:11` | 打通 child 视图/审批，不新建 agent 状态机 |
| Tasks 在 session journal | `bingo-tasks/src/journal.rs:15–17,37–63` | 读取原 extensions，不建 Rei task database |
| 后台 shell jobs 发布实时视图 | `bingo-tool-bash/src/jobs.rs:20–27,275–299` | 呈现 signals；现 generic custom view 只有 fold（`Content.tsx:55`），不要拿“工具调用结束”代替“后台进程结束” |
| MCP 状态和 enable/disable/reconnect | `bingo-mcp/src/command.rs:26–83,158–178` | 首先把已有动作做得可发现；OAuth、配置写入另算缺口 |
| 调度/Wake 与驻留 gateway | `bingo-schedule/src/lib.rs:1–24`；`bingo/src/gateway/service.rs:1–10` | 不能说核心完全没有计划任务或驻留服务；也不能把该 gateway 当成已能接管 Rei stdio 会话 |
| 用量与 context/compaction | SDK `Usage`/`ContextUsage`；Rei `session.ts:156–163,210` | 用核心 counters，不另算“看起来更准”的数字 |
| 通用 View/Action/form 机制 | `schema/rpc.json` 的 `Action/Interaction/View`；Rei `Content.tsx`、`InteractionPanel.tsx` | 很多命令已能用，不必把每个命令变成独立设置页 |

真正需要新增产品契约的主要是：**权威仓库变更范围/安全恢复预检、文件引用输入语义、全文检索与归档、managed worktrees、MCP OAuth/安全配置写入、浏览器自动化反馈及细分用量**。其中多数适合插件，不适合增加 kernel 业务名词。

## 6. 安全、分发与后台生命周期：应单独把关

### 权限提示不等于沙箱

Codex 官方明确区分 OS sandbox 与 approval；子进程的文件/网络边界由系统强制。[O5] Rei 的 Electron renderer/browser sandbox 已存在，但 bingo 当前 shell 启动链是 `Command::new(shell()).arg("-c")`，包裹 process group/job object/kill-on-drop（`bingo-tool-bash/src/run.rs:192–212`），未见 OS 文件/网络 sandbox。搜索 crates 中 `sandbox / Seatbelt / bwrap / landlock` 亦未命中。

因此可以说“有审批策略与桌面隔离”，**不能说 agent 执行已被限制在项目沙箱**。若未来要默认免确认执行、安装任意 MCP、浏览器操作登录账户或无人值守工作，需先由 bingo 确立执行隔离与授权模型；这不是在 Rei Settings 增加一个开关就解决的问题。

### 关窗、退出与切项目不是一回事

- macOS 关窗当前 hide；退出会确认并关闭 panels/runtime；非 macOS 关窗走 quit。`Rei/src/main/index.ts:59–65,103–123`。
- 切项目会替换 stdio runtime，已提示正在运行的工作会停止。`ipc.ts:121–128`、`runtime.ts:18–26`。
- 核心调度依赖有 bingo 进程运行；另有 gateway service，但本次没有验证它接管桌面会话。不得把添加托盘图标包装成关电脑仍可执行。
- 对照 Cowork cloud/Claude cloud 与 Cursor cloud agents 时，需明确那是远程执行环境，不是普通桌面后台通知。[A1][A2][C4]

### 已有打包，不等于已完成各平台交付与更新

Rei `electron-builder.cjs:12–17` 支持可选 bundled binary、mac dmg/zip、Windows NSIS、Linux AppImage/deb；Settings 有 runtime 选择与版本。**本次未验证签名/公证、正式下载产物、自动更新或各平台安装体验。** 当前 main/menu/package 未见 autoUpdater/更新入口，不宜对外许诺静默自动升级。Claude 文档可作为“About、版本诊断、平台更新行为明确”的参考。[A1]

后续分发验收应先保证正确 runtime 配对、可读错误与获取更新路径，再决定是否需要自动更新；不能把 GUI 和 core 两个独立版本的升级语义交给用户猜。

**Windows 行为对齐是发布准入门槛，独立于上述八项市场功能建议。** 当前 bingo `run.rs:64–72` 仍仅找 `/bin/bash` 或 `/bin/sh`，文件头 `21–27` 明确记录 Windows shell 尚未完成。必须区分“Windows 编译/安装包存在”“GUI PTY 可运行 PowerShell”和“agent Bash 工具在 Windows 真能执行”：它们是三件事。该风险已告知发布负责人；未进行 Windows 设备复现，未在此扩大范围修改。未完成对齐前，预发布说明应明确 agent shell 的平台限制，而不能以 GUI 打包通过作为完整 Windows 支持的验收。

## 7. 明确不值得照抄的东西

1. **完整 IDE。** 不补全 VS Code 扩展、LSP、debugger、多文件编辑器；文件预览、定位和 Open in editor 已能解决当前最痛一层。[C5] 是对照，不是模板。
2. **多 agent 卡片大厅、头像排行、漂亮但没有控制权的进度仪表盘。** 先做到 child 审批能到人、工作目录可辨、结果可审查；不从一句“还在做”生成百分比。
3. **自动 merge/自动修 CI 作为默认。** Claude 有这些选项，[A1] 但它们要求成熟的测试、分支保护与明确授权。Rei 当前更缺人审阅结果的能力。
4. **一键回滚一切、自动清理所有旧 worktree。** Shell/MCP 外部副作用不是文本快照；worktree 中的本地环境和未提交工作有价值。竞争产品的清理机制不是本产品的数据删除授权。[O3][W2]
5. **为了“有规划”再造 Plan Mode。** 已有 `plan`，先把计划/任务状态和批准后执行做清楚，不增加相互冲突的两套状态机。Cursor 的可编辑计划值得参考，但无需一次实现其全部模式体系。[C2]
6. **自建插件市场和海量模板。** 当前先需要可信连接配置、来源、故障诊断、secret 生命周期；没有这些，商店只会放大供应链风险。[C1][W3]
7. **云端农场、手机遥控、永远运行的自治调度。** 能力强但涉及身份、沙箱、账单、生命周期和运维。当前先把本地一项工程工作做完整；核心 schedule/gateway 现有能力可按需暴露，不凭 UI 许诺云端 SLA。[A2][C4]
8. **炫耀 tokens/花费/运行时长的总览页。** 只显示帮助当下决策的权威数字；未知成本不计算出漂亮但不真实的美元数。

## 8. 推荐推进顺序与验收边界

**第一段：能放心交付。** 建议 1 的只读审阅 + 建议 2 的 child/attention 接线；恢复安全性在 bingo 完成前不开放误导性“一键恢复”。

**第二段：能顺畅继续工作。** 建议 3 文件上下文、建议 4 连接管理、建议 5 会话检索整理。可独立交付的小入口先走，避免为“同步竞品”展开全产品迁移。

**第三段：能扩大任务量。** 建议 6 worktrees，再加 7 验证证据与 8 用量透明。8 的现有字段呈现可作为小切片提前，但不抢占 P0 接线和安全恢复的资源。

视觉上沿用当前安静工作区：聊天保持主线；需要审阅时展开 Changes，需要介入时出现活动条目，需要上下文时出现可删除引用。**新增能力应落在明确的对象与动作上，而不是每新增一个能力就永久占一块卡片。** 本次没有做视觉截图对比，不声称具体布局已经视觉验收。

本次验证记录：

- 已完成：Rei 生产入口/组件/主进程读取；bingo 原 schema、SDK 和实际注册插件读取；官方正文取证与来源核对。
- 未做：竞品实机操作、Rei 运行时/Electron UI 流程、child 审批复现、OS 通知、Windows/Linux 安装与运行、任何生产发布验证。
- 未运行 npm/cargo 测试：唯一产物是本报告，没有修改执行代码；阅读到的既有测试不计作本次通过证据。
- P0 子会话等待与恢复漂移问题是基于接线/实现的高置信风险，应以 focused integration fixtures 先验证，而不是未经复现就宣称已发生用户数据事故。

## 官方来源索引

所有页面访问于 2026-09-05。下列链接用于明确支持本文对应功能，不表示所有平台/账户均可用；正文中平台或版本限制优先。

- [O0] [OpenAI 旧 features 入口（当前为迁移导航）](https://developers.openai.com/codex/app/features)：仅用于记录文档迁移，不据此做功能判断。
- [O1] [Projects and chats](https://learn.chatgpt.com/codex/projects)：项目/多目录、pin、search、archive/restore 与权限边界。
- [O2] [Code review — app](https://learn.chatgpt.com/codex/code-review?surface=app)：多范围 diff、逐行评论、file/hunk stage/revert、外部编辑器。
- [O3] [Git worktrees](https://learn.chatgpt.com/codex/environments/git-worktrees)：创建、Local handoff、环境、保留/清理/恢复。
- [O4] [Notifications](https://learn.chatgpt.com/codex/notifications)：完成/权限/问题通知、Activity；Activity 以 “when available” 限定。
- [O5] [Sandboxing](https://learn.chatgpt.com/codex/sandboxing)：审批与 OS sandbox 区别、平台实施与本地命令边界。
- [A1] [Claude Code Desktop reference](https://code.claude.com/docs/en/desktop)：Code tab 的 diff、files、context、tasks/subagents、worktree、preview、connectors、usage、通知、部署/更新及平台差异。页面内部部分 @mention 适用环境表述不完全一致，本报告只使用本地会话共同确认的能力。
- [A2] [Getting started with Cowork](https://support.claude.com/en/articles/13345190-getting-started-with-cowork)：cloud beta、跨设备继续、项目、插件、任务调度与连接器权限；未沿用旧版仅本地运行的断言。
- [C1] [Cursor MCP](https://cursor.com/docs/context/mcp)：安装/管理、OAuth、传输、状态诊断、日志与安全。
- [C2] [Cursor Plan Mode](https://cursor.com/docs/agent/plan-mode)：澄清/研究→可编辑计划→Build。
- [C3] [Cursor context mentions / prompting](https://cursor.com/docs/context/mentions)：多来源 @ 引用、图片、模型、context breakdown。
- [C4] [Cursor review](https://cursor.com/docs/agent/review)：当前返回官方审阅指南，含实时 diff、Review/Find Issues、云任务与验证；不据此断言 checkpoint 的精确覆盖范围。
- [C5] [Cursor Agents Window](https://cursor.com/docs/agent/agents-window)：跨项目/环境、文件搜索、diff/PR、worktrees、IDE 往返；页面标记 Cursor 3 GA。
- [W1] [Cascade overview](https://docs.windsurf.com/windsurf/cascade/cascade)：Code/Chat、todo、消息队列、命名 checkpoint/revert、引用旧会话、并行。
- [W2] [Cascade worktrees](https://docs.windsurf.com/windsurf/cascade/worktrees)：Worktree 模式、merge、setup hook、清理行为。
- [W3] [Cascade MCP](https://docs.windsurf.com/windsurf/cascade/mcp)：安装/配置、工具开关、OAuth、管理员控制。W1–W3 正文当前称 Devin Desktop，版本边界须保留。
