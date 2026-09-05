# Agent 桌面工作台：生产界面与首次使用路径

研究日期：2026-09-05。对象：OpenAI Codex / ChatGPT desktop 的开发工作流、Anthropic Claude Desktop 的 Code tab。只读研究；成功读取 9 个不同官方页面，另有 1 次 404；使用 Phi 独立 Space 目视 Claude 官方演示，直接查看 Codex 官方浅/深截图。搜索服务返回反爬挑战后，改为直接访问官方资料。未登录、安装、变更配置或修改源代码。

**结论：Rei 应是可恢复、可检查的工程工作台，而不是聊天网页或功能仪表盘。** 先解决「运行核心可用 → provider 可用 → 工作目录明确 → 开始真实会话」；界面常态保留项目/会话列表、任务主线、一个 composer，证据面按需出现。

## Rei 的明确反馈（2026-09-05）

以下产品取舍优先于本文早期建议：用户否决大 Logo、口号、三条通用入口堆叠的首页；新会话改为简短标题与真实输入区组成一个整体。选择器不用系统原生弹出样式。项目目录是可选上下文，无项目时使用应用专属临时目录。浏览器默认位于右侧工具区，终端从下方展开，两者入口放在右上 titlebar。启动使用短暂、可跳过且遵循 reduced-motion 的过渡。上述新版已经实现与验证，但尚未收到用户对新视觉的最终认可。

## 五项最可执行模式

| 模式 | 已核实的官方事实 | 对 Rei 的建议（不是已实现能力声明） |
|---|---|---|
| 项目与会话是稳定对象 | Codex 支持项目、pin、搜索、rename、archive；建议每个 distinct outcome 独立 chat。[1] Claude sidebar 支持并行 session、项目分组及状态/环境筛选；另有当前会话的 background tasks pane。[2] | 左栏采用目录/项目 → 会话；一行显示标题与真实运行/待决策/失败状态。跨会话状态与当前 session 内部任务分开，不用 Crew 头像墙替代责任、输出和阻塞信息。 |
| 主线连续，证据可展开 | Claude 默认 Normal 把工具调用折叠为摘要，Verbose 展示全部；可打开 diff、terminal、file、tasks 等 pane。[2] Codex review pane 支持多种 Git scope 和逐行意见。[3] | assistant 正文为主，成功工具用「动词 + 目标 + 结果」行；参数/输出展开查看。错误与权限请求提升权重。右栏只显示当前需要的证据，窄窗先收辅助 pane。 |
| 一处设置当前执行上下文 | Claude prompt area 有 environment、folder、model、permission mode，可在会话中切换 model/mode；有独立 effort 菜单快捷键。[2] Codex 官方截图将模型、reasoning、权限与输入放在同一 composer 区域；当前权限文档明确 selector 在 composer 下方。[4]（截图见下文 S1–S2） | 一个 composer 边界、一处 provider/model/effort/mode 当前值。provider/model 联动；只展示模型实际支持的 effort。环境/目录可用轻量上下文行，不在 header 再重复整套配置。发送/停止位置固定，真实区分运行中送入消息与排队。 |
| 首次运行与失败属于产品主流程 | Codex signed-out screen 区分浏览器账户登录与 API key 登录，profile 可看当前身份/密钥状态；两种方式影响计费和能力。[5] Claude 区分 auth 403、目录失效、工具/PATH、Git 等故障，并给出不同恢复办法；Claude Desktop 自带 engine。[2][6] | 优先识别已有 bingo 配置，不强迫重复 onboarding。逐项展示 readiness 与可执行修复；失败保留草稿和可访问的设置，不循环「Connecting」。不要把「配置存在」等同「凭据有效」。 |
| Native 基础行为先于装饰 | Codex 可设置主题、UI/code 字体、通知、发送习惯和快捷键，macOS `Cmd+,` 开设置。[7] Claude 有会话切换、stop、pane、model/mode/effort 快捷键；不在当前会话时可发完成通知。[2] | 提供系统/浅/深主题、键盘 focus、真实窗口菜单与设置快捷键；UI sans + code/path monospace，语义状态不能仅靠颜色。减少边界比增加阴影更重要。 |

## 首次使用、认证与设置：建议的完整路径

以下是 **Rei 的设计建议**，不是两家厂商已经采用的统一向导；尤其不要把 Claude 的「已捆绑 engine」误当成 Rei 已具备该能力。

| 阶段 | 用户应看到什么 | 失败时的具体恢复 |
|---|---|---|
| 1. 检测已有环境 | 使用中的 bingo executable、连接阶段、版本/兼容状态；有完整配置则跳过 setup | 缺 binary：选择可执行文件、打开官方安装说明；无权限/启动失败/协议不兼容分别说明。不要未经确认静默安装、改 PATH 或下载替换。 |
| 2. 读取 provider 状态 | 已配置 provider 和可用模型；明确「已配置 / 尚未验证 / 认证失败」，不给密钥回显 | 缺 provider：进入 provider 设置；认证失败：针对该 provider 重新认证或更换凭据。后端断连与 provider 认证失败不是同一种错误。 |
| 3. 完成身份或 API 配置 | 使用后端实际支持的登录方法；若支持浏览器登录，显示等待回调、取消、重新发起；若支持 key，安全录入后只展示掩码状态 | 浏览器取消/超时保留当前页面与输入；返回可恢复而非从头重装。自定义 endpoint/model 只在真实支持时出现。显式 Test connection 不应变成未告知的收费推理请求。 |
| 4. 确认工作目录与默认行为 | 原生目录选择；显示会话实际 cwd、model、permission 默认值；提交前可修改 | 目录不存在/不可访问：重新选择；非 Git 目录仍按 bingo 能力工作，不为了展示 Changes 自动执行 git init。 |
| 5. 首次真实任务 | 普通 composer、简短示例入口、能够运行的发送按钮；就地展示工具和所需决策 | 错误保留 draft 与 transcript，Retry 针对失败层；提供不含秘密的诊断信息。未完成配置应解释禁用原因并给设置入口。 |
| 6. 日常继续与重新进入 | 上次项目/会话、真实状态；认证或 runtime 恢复后回原任务 | 不清空历史、不强制重复 onboarding；只有受影响的动作受限，设置和历史查看继续可用。 |

**设置 IA 建议：**

- **外观与交互**：theme、UI/code 字体或字号、发送快捷键、通知；这些是 GUI 偏好。
- **运行核心**：当前 executable、版本、连接/兼容状态、Retry、选择路径、脱敏诊断；不与模型 provider 混为一个「Connected」指示灯。
- **Providers 与认证**：已配置 provider 列表、当前状态、后端支持的登录/密钥管理及模型发现；设置只调用 bingo 的权威能力，不在 renderer 自造配置格式或持久化规则。
- **默认行为**：新会话 model/effort/permission；明确区分全局默认与当前 session override。保存未成功时不可假装已应用；高风险权限文案解释实际授权边界。

**可核实的权限差异：** Claude Manual 会在编辑/执行前请求许可；Codex 当前 Ask for approval 允许 workspace 内的读写与常规命令，在越界/网络动作前请求许可。[2][4] 因此 Rei 不能仅复制厂商标签后假设语义等价；标签和可用选项必须服从 bingo。

## 截图目视与视觉锚点

### Codex：两份官方图片已直接查看

- [S1 浅色](https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp)
- [S2 深色](https://learn.chatgpt.com/images/codex/app/codex-app-basic-dark.webp)

**图中可观察：** 左栏是连续的低对比表面，含 New chat、Search、Pinned、Projects、Chats；主区是单一大画布。composer 集中权限、模型、Extra High、附件和发送；目录/local/branch 在下一条轻量上下文行。顶栏显示编辑器、Commit、terminal 和增删计数入口，并无永久空的右侧 dashboard。两种主题保留同一层级和布局。

**适用边界：** 图中模型名/权限文案只能证明这份素材的画面，不能证明当前默认值；当前 [Codex app 入口][8] 已使用 ChatGPT desktop app 文案，功能解释以本次读取的现行文档为准。外部蓝紫壁纸不是应用主画布的渐变设计。

### Claude：官方 live demo 已通过 Phi 截图并目视

- [S3 来源页面：Claude Code product][9]，页面中的 `acme-dashboard / Add a dark mode toggle to settings` 演示。
- 本次临时观察图：`/tmp/rei-claude-official-workspace-2026-09.png`；未将图片另行加入仓库。该路径只是本机临时证据，持久引用使用来源页面。

**图中可观察：** 左侧 Pinned/Scheduled/Recents 紧凑行；中间正文、`Read 4 files, searched the codebase` 普通摘要行、`Edited ThemeProvider.tsx +18 -2` 和一个展开 diff；右侧是具体项目的预览。底部输入、Auto、Opus、Extra high 就地排列。一级 pane 直接承担分区，普通成功工具没有逐条厚卡片。

**重要纠偏：** 右侧 Appearance / Theme / Density / Reduce motion 是 agent 正在生成的 **项目设置页预览**，不是 Claude 自身设置；不能用它证明 Claude 具备这些设置项。它也是官方网页中的产品演示，不是本机安装应用的实测。不要从营销页字体、颜色或演示尺寸反推生产 app 精确 token。

**Rei 视觉建议：** 窄的持续导航 + 稳定阅读列 + 任务触发的证据面；灰阶为底，单一稀疏强调色；路径、命令、diff 用 monospace；边界用于 composer、浮层和展开证据，不用于每条记录。优先让当前任务、阻塞原因与恢复动作清晰，其次才是所有装饰。

## 三项反模式

1. **功能墙 / 卡片墙**：把 session、工具步骤、Crew、Changes、Settings 都做成同等重量的常驻卡片，挤压真正的工作。对照官方截图，删无任务依据的 pane 与重复容器。
2. **重复或虚假的执行上下文**：header、composer、settings 同时给出不同 model/mode；凭空显示 cloud、worktree、自动审批、Git 操作或认证状态。只呈现 bingo 实际能力；不支持就隐藏或明确解释限制。
3. **只有 happy path 的 onboarding**：无限连接动画、错误只吐 raw stderr、丢 draft、把缺 binary 与 invalid key 混为「连接失败」。必须能定位失败层，给一个主要恢复动作并回到原任务。

## 官方资料（本次重新读取）

[1]: https://learn.chatgpt.com/docs/projects
[2]: https://code.claude.com/docs/en/desktop
[3]: https://learn.chatgpt.com/docs/code-review?surface=app
[4]: https://learn.chatgpt.com/docs/permission-modes
[5]: https://learn.chatgpt.com/codex/auth
[6]: https://code.claude.com/docs/en/desktop-quickstart
[7]: https://learn.chatgpt.com/docs/reference/settings
[8]: https://developers.openai.com/codex/app/
[9]: https://claude.com/product/claude-code

1. [OpenAI Projects][1] — 持续上下文、会话、目录与搜索。
2. [Anthropic Use Claude Code Desktop][2] — 会话、pane、工具摘要、权限、快捷键、故障排查。
3. [OpenAI Code review][3] — Git scope、真实 repository state、inline review。
4. [OpenAI Permission modes][4] — composer 附近模式入口、sandbox 与 approval 分离。
5. [OpenAI Authentication][5] — signed-out screen、browser/key 分流与账户状态。
6. [Anthropic Desktop quickstart][6] — 内置 engine、首次项目和任务。
7. [OpenAI Settings][7] — appearance、字体、通知、快捷键与发送行为。
8. [OpenAI Codex app 入口][8] — 当前 ChatGPT desktop 工作台文案。
9. [Anthropic Claude Code product][9] — 官方可视演示。

**未验证：** 未安装或操作两家真实桌面客户端；未测试登录、收费、后台执行或错误恢复。Rei 建议需对照 bingo app-server 的真实契约后实施，本文不是新增产品能力的授权或规格。
