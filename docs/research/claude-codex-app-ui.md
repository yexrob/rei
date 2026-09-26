# Claude app 与 Codex app 软件界面研究（2026）

> **研究前提：本研究不以 Rei 当前视觉与 v0.1 功能边界为基线。** 本文不分析、不延续 Rei 现有截图、布局、配色或样式，而是从 Anthropic Claude app（优先 Claude Desktop / Claude Code 工作台）与 OpenAI Codex app 的成熟产品界面中独立提炼方向；对 bingo 的转译面向长期产品形态，既包含会话、对话、工具执行、工作区和运行状态，也允许真实的常驻 Crew、变更审查与监督能力。
>
> **研究/访问日期：2026-08-25。** 范围截至该日可访问的 2026 年官方资料；界面会持续演进。只使用 Anthropic/OpenAI 第一方产品页、帮助文档、开发者文档、发布文章及其中的官方截图/演示。

## 1. 方法与证据边界

- **【可直接观察事实】**：官方正文明确描述的功能、标签、位置或状态；或官方截图/演示中可直接读到的界面内容。
- **【设计推论】**：由多条事实归纳出的视觉层级、交互意图或设计语言，以及面向 Rei 的设计建议。推论不是厂商自述。
- 官方营销页的网页字体、色值和间距不等于软件本体；本文只把嵌入的产品截图/演示及其 caption 作为软件界面证据，不从营销站 CSS 推断产品的精确 token。
- 产品名称在 2026 年内发生演进：OpenAI 于 2026-02-02 发布独立 Codex app；当前官方文档称其能力位于 ChatGPT desktop app 的 Codex 专用视图中，历史独立保留。本文以“Codex app / Codex 视图”统称，并在时间敏感处注明阶段。

## 2. Claude Desktop / Claude Code

### 2.1 信息架构与布局

1. **【可直接观察事实】** Claude Desktop 顶部以 **Chat / Cowork / Code** 区分三类工作；Claude Code 文档把桌面端描述为可视化 coding workspace。Code 首页左侧可见 **Home / Code / New session / Routines / Customize / More**，并以 **Pinned / Scheduled / Recents** 组织工作。  
   来源：[Claude Code desktop](https://code.claude.com/docs/en/desktop)、[Claude Code product](https://claude.com/product/claude-code)、[Claude Desktop download](https://claude.com/download)

2. **【可直接观察事实】** 左侧 sidebar 列出 sessions；用户可并行启动多个 session，并在它们之间切换，而不必等待当前任务结束。远程 web sessions 也可从 Desktop 打开。  
   来源：[Claude Code desktop](https://code.claude.com/docs/en/desktop)、[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)

3. **【可直接观察事实】** 一个 session 内可以排列多个 pane，包括 chat、diff、browser、terminal、file、plan、tasks 与 subagent；pane header 可拖动，边缘可 resize。  
   来源：[Claude Code desktop](https://code.claude.com/docs/en/desktop)

4. **【设计推论】** Claude 把“会话”当作第一层持久对象，把 chat 当作会话中的主线，再将文件、diff、终端等结果作为同一工作上下文的可组合视图。这比固定三栏更接近“可展开的工作台”；bingo 应优先沿用这种成熟范式，再按真实需要决定哪些 pane 常驻、按需出现或允许重排。

### 2.2 对话、工具活动与审查

1. **【可直接观察事实】** Claude 的对话 transcript 支持 **Normal / Verbose / Summary**：默认模式平衡聊天与工具活动，Verbose 展示逐步细节，Summary 压缩工具调用。  
   来源：[Claude Code desktop](https://code.claude.com/docs/en/desktop)

2. **【可直接观察事实】** 官方界面截图中，工具步骤以垂直时间线呈现：`Read`、`Write` 等动作有状态圆点、粗体动作名、文件名与次级说明；代码写入以内嵌 diff 预览展示；生成中显示 **Pondering…**，composer 仍可 **Queue another message…**，停止按钮在 composer 末端。  
   来源：[Claude Code product](https://claude.com/product/claude-code)

3. **【可直接观察事实】** 点击 session 顶部的变更计数（例 `+12 -1`）可打开 diff；左侧是 changed files，右侧是 diff。用户能逐行评论，并通过 **Review code** 请求审查。  
   来源：[Claude Code desktop](https://code.claude.com/docs/en/desktop)

4. **【设计推论】** Claude 的视觉层级不是让每个工具事件都变成同等重量的“消息卡片”，而是让 assistant 叙述保持主线，工具动作用缩进、状态点、动词和少量结构化内容构成可扫描的执行轨迹；详细证据按需展开。

### 2.3 Composer、权限与运行状态

1. **【可直接观察事实】** 新 session 的 composer 周围可选择 environment、project folder、model 与 permission mode；`+` 菜单承载附件、skills、connectors 与 plugins。官方截图亦可见 **Ask before editing** 位于 composer 的就地控制区。  
   来源：[Claude Code desktop quickstart](https://code.claude.com/docs/en/desktop-quickstart)、[Claude Code desktop](https://code.claude.com/docs/en/desktop)、[Claude Code product](https://claude.com/product/claude-code)

2. **【可直接观察事实】** Scheduled 工作在 sidebar 的 **Scheduled** 分区可见；routine 详情包含 **Run now**、Active/Paused、运行历史与权限。任务完成或需要输入时可触发系统通知；tasks pane 和 CI status bar 把长任务的进度带到聊天之外。  
   来源：[Scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)、[Claude Code desktop](https://code.claude.com/docs/en/desktop)

3. **【设计推论】** 权限不是藏在全局设置里的技术参数，而是影响当下执行的会话级模式，因此应靠近输入区并允许会话中切换。运行状态也不是只存在于当前 transcript，而应跨会话保持可见。

### 2.4 视觉风格与设计语言

1. **【可直接观察事实】** 官方软件截图同时展示浅色与深色界面；容器多以低对比边界、圆角和留白分区。正文使用 UI sans，路径、代码和 diff 使用 monospace。Claude 的暖珊瑚/橙色主要用于品牌与活动状态，成功/文件操作另用绿色等语义色。  
   来源：[Claude Code product](https://claude.com/product/claude-code)、[Claude Code desktop](https://code.claude.com/docs/en/desktop)

2. **【设计推论】** Claude 的成熟感来自“编辑式克制”：大面积中性底色、低噪分隔、明确文字层级，再用暖色表达 agent 活性。品牌色不是铺满界面，而是稀疏地标记身份与状态；代码内容保持工具化、等宽、信息密度较高。

## 3. OpenAI Codex app / ChatGPT desktop Codex 视图

### 3.1 产品演进与信息架构

1. **【可直接观察事实】** 独立 Codex app 于 **2026-02-02** 在 macOS 发布，Windows 于 **2026-03-04** 上线；发布版将工作组织为 grouped-by-project 的 separate threads。当前官方更新说明这些能力已位于 ChatGPT desktop app 的 Codex 中。  
   来源：[Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)、[What’s new](https://learn.chatgpt.com/docs/whats-new)

2. **【可直接观察事实】** 当前 Projects 页面说明：project 对应目录或代码库，每个 distinct outcome 建议独立 chat；官方插图 caption 明确为“multiple projects in the sidebar and chats in the main pane”。  
   来源：[Projects](https://learn.chatgpt.com/docs/projects)

3. **【可直接观察事实】** Codex 有跨 chat 的 Activity view，通过 sidebar bell 进入，聚合 unread、running、waiting；可见状态包括 **Running / Needs input / Ready / Blocked**。Scheduled 结果进入 sidebar 中的 inbox，带 unread indicator，并有 **All / Active / Paused** filters。  
   来源：[Notifications](https://learn.chatgpt.com/docs/notifications)、[Automations](https://learn.chatgpt.com/docs/automations)、[Long-running work](https://learn.chatgpt.com/docs/long-running-work)

4. **【设计推论】** Codex 的信息架构比 Claude 更“项目管理式”：project → chats 是稳定的主轴，Activity 与 Scheduled inbox 是面向并行工作的收件箱。它牺牲部分自由布局，换取更明确、可预测的导航。

### 3.2 对话、审查、终端与工作区

1. **【可直接观察事实】** 发布版允许在 thread 内检查 agent changes、评论 diff，并在本地编辑器中打开工作。当前 review pane 提供 **Unstaged / Staged / Commit / Branch / Last turn** 范围，支持 inline comments，以及按整份 diff、文件或 hunk 执行 stage、unstage、revert。  
   来源：[Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)、[Code review](https://learn.chatgpt.com/docs/code-review?surface=app)

2. **【可直接观察事实】** 每个 chat 有一个 scoped 到当前 project/worktree 的 terminal；从窗口右上角 terminal icon 或 `Ctrl+\`` 打开，官方插图 caption 明确为聊天下方的 **terminal drawer**。  
   来源：[Integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal)

3. **【可直接观察事实】** 新 chat 可在 composer 下选择 **Worktree** 与起始 branch；chat header 提供 **Create branch here** 与 **Hand off**，可把工作树带到本地环境继续。  
   来源：[Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)

4. **【可直接观察事实】** 权限模式可从 composer 附近选择并在 chat 中切换；发布文档描述默认限制在当前工作目录/branch，网络等高权限动作会请求许可。  
   来源：[Permission modes](https://learn.chatgpt.com/docs/permission-modes)、[Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

5. **【设计推论】** Codex 把重工具放进 drawer/pane/header action，而不是永久挤压对话宽度；chat 是控制面与叙事主线，diff、terminal、Git 是任务需要时打开的“证据面”。

### 3.3 视觉风格与设计语言

1. **【可直接观察事实】** 官方文档插图展示浅/深两套界面：大面积中性色、弱边界、圆角浮层、系统 sans 与代码 monospace；状态与选中项用克制的强调色。Settings 允许选择 base theme、accent/background/foreground colors 以及 UI/code fonts。  
   来源：[Settings](https://learn.chatgpt.com/docs/reference/settings)、[Projects](https://learn.chatgpt.com/docs/projects)、[Code review](https://learn.chatgpt.com/docs/code-review?surface=app)、[Integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal)

2. **【设计推论】** Codex 不存在一套必须照抄的固定品牌配色；其更稳定的语言是 ChatGPT 式平静中性表面、较低装饰密度、清晰的 project/chat 层级，以及把 Git/运行状态做成紧凑而语义明确的控件。

## 4. 共性与差异

| 维度 | 共性【可直接观察事实】 | Claude 倾向【可直接观察事实】 | Codex 倾向【可直接观察事实】 |
|---|---|---|---|
| 基本对象 | 都支持多个持久会话/聊天与并行工作 | sidebar session；session 内自由 panes | sidebar projects；main pane chats |
| 主工作流 | chat 承担指令与叙事主线 | chat、diff、browser、file、terminal 可排列 | chat 固定为主，terminal drawer / review pane 按需出现 |
| 工具活动 | 结果可检查，不只给最终答案 | transcript detail 可切 Normal/Verbose/Summary | 重点强化 review、Git、worktree 与 handoff |
| 状态 | 状态跨当前消息可见，并可通知 | Scheduled、tasks pane、CI status bar、OS notification | Activity、Scheduled inbox、Running/Needs input/Ready/Blocked |
| 权限 | 都把权限作为会话运行模式 | composer 附近的 permission mode | composer 附近选择并可在 chat 中切换 |
| 视觉 | 中性底、低噪边界、圆角、sans + mono、浅/深主题 | 暖色 agent identity，更像可重排工作台 | ChatGPT 中性克制，更像项目/任务收件箱 |

**【设计推论】** 两家的核心共识不是某个 sidebar 宽度或某种灰色，而是四条结构原则：

1. 会话/项目列表是并行 agent 工作的“仪表盘”，不能只是历史记录。
2. 对话是意图与结果的主线；工具日志需要结构化、压缩和渐进展开。
3. 权限、停止、运行状态靠近发生动作的地方，并使用文字或图标+文字，而非只靠颜色。
4. diff、终端、文件等重内容是次级工作面，在需要时打开，不应把每次普通对话都变成 IDE。

## 5. bingo 长期产品可借鉴的方向

以下全部是**【设计推论】**。它们不以 Rei 当前原型、现有 PRD、协议或已实现功能为约束，而是面向 bingo 的长期桌面产品形态。

### 5.1 推荐的信息架构

- 采用**三层工作台结构**：左侧工作区与会话仪表盘、中央对话与执行主线、右侧按上下文常驻或切换的监督面板。
- 左栏把 workspace/project 作为长期上下文，把 session/thread 作为具体任务；会话行不仅显示标题和时间，也显示 `Running`、`Needs input`、`Failed`、`Ready` 等跨会话状态。
- 中央区域保持 chat-first，但不是普通聊天壳：assistant 叙述、工具轨迹、计划、决策请求与结果共同构成一条可追溯的任务时间线。
- 右侧监督面板可承载 Crew、Changes、Review、Decisions 与任务状态。它应根据当前任务显示真实的高价值信息，而不是固定堆叠所有模块。
- 工作区、运行环境、模型、thinking 与 permission mode 属于任务上下文；应靠近 header 或 composer，但降低常态视觉重量。

### 5.2 对话、Crew 与工具执行

- assistant 文本保持最高阅读优先级。工具调用使用连续执行轨迹：状态 glyph + 动作名 + 目标 + 一行摘要；默认折叠参数和原始输出，错误与待决策状态提高视觉优先级。
- 同一任务中的 Crew 成员应显示角色、当前动作、状态和可检查结果；视觉上服务于“监督并行工作”，而不是变成头像社交列表。
- 对同一轮多个工具步骤提供摘要/详细两级，而不是每个工具都做成厚重卡片。状态必须同时有形状、图标或文字，不只靠绿红颜色。
- Changes 与 Review 作为证据面：先给文件与增删摘要，再按需打开 diff、逐行意见或审查结论；中央对话仍是意图与决策主线。
- streaming 时把停止动作固定在 composer 的预期位置；完成后恢复发送，不让布局跳动。长任务可在 composer 上方保留一个清晰、可暂停或调整的目标进度层。

### 5.3 视觉方向

- 以**冷静、低噪、工具可信**为锚：中性大底、有限的层级表面、低对比分隔、清晰文字层级；代码、路径、工具输入输出统一使用等宽字体。
- 强调色只承担 active session、focus、primary action 与 agent-running 等少数职责；success、warning、error 使用独立语义色，并辅以图标或文字。
- 用留白、对齐与字号建立一二三眼：第一眼当前任务与执行状态；第二眼对话、工具轨迹和 Crew；第三眼时间戳、模型、路径与审查细节。
- 圆角和阴影保持一种材质逻辑：主布局靠边界与底色分区，浮层才使用阴影；避免每段消息都成为悬浮卡片。
- 浅、深主题应共享同一层级关系，而不是分别设计两套性格；确保正文、次级文字、diff 与 error 状态在两种主题均具可读对比度。

### 5.4 直接沿用成熟范式，不做视觉创新

- 产品形态直接向 Claude Code App 与 Codex Desktop 靠近，不重新发明项目、会话、对话、composer、pane、review 或状态呈现的基本规则。
- 融合只发生在两套既有成熟模块之间：Claude Code 提供对话、工具活动与 composer；Codex 提供 Projects、Threads 与 Changes/Review。不要为了形成“第三种风格”增加新的导航、图形、标记或组件。
- bingo 元素只以产品内容进入既有组件，例如 Crew、工具轨迹、Changes/Decisions 与多 provider 运行上下文；其外观继续使用 Claude/Codex 已建立的列表、pane、tab、status 和 control 形式。
- 判断标准不是“看起来有多独特”，而是“是否像 Claude Code / Codex 同类成熟桌面软件，并能自然承载 bingo 的能力”。

## 6. 不应照搬

以下全部是**【设计推论】**：

- **不复制品牌表层。** 不复制 Claude 暖珊瑚或 Codex/ChatGPT 强调色、字体、精确圆角、logo 或图标；学习其层级与状态语法，而不是做换 logo 的仿品。
- **不机械拼接两套产品。** Claude 的 pane、Codex 的 project/review 与 bingo 的 Crew 必须围绕同一任务主线组合，而不是各占一个互不相干的区域。
- **不把所有信息卡片化。** 两家的真实产品都依赖轨迹、drawer、pane、sidebar 分层；无端的卡片墙会降低长任务扫描效率。
- **不让完整 IDE 淹没 agent 工作流。** Diff、terminal、browser、file 等能力可以存在，但它们是可检查的证据面，不应夺走对话、执行状态与人的决策权。
- **不把多代理做成装饰。** Crew 必须表达真实责任、进度、阻塞和产出；若只有头像与在线点，会退化成没有操作价值的组织图。
- **不滥用 personality、宠物或氛围装饰。** 差异化优先来自任务编排、监督与证据结构，而不是削弱专业状态反馈的表面趣味。

## 7. 简约成熟专项：从观察到下一稿约束

本节把“简约”拆为可执行指标。它不等于减少信息，也不等于把所有东西变浅、变圆；它指的是：**常态只保留当前动作所需的工作面，细节在原位渐进展开，视觉重量与任务优先级一致。**

### 7.1 官方界面的可观察事实

#### Claude Code Desktop

- **【可直接观察事实】** 当前 Claude Code 产品页内嵌的官方 `AppShell` 演示采用三列工作态：左侧全局导航与 session，中间 transcript 与 composer，右侧 Browser/Preview pane。演示外框约 `1444 × 812`，左栏 `312px`（约 `22%`），右侧 pane `flex-basis: 33%` 且最大 `480px`，中央正文列最大 `728px`、左右 padding `40px`。这些数值来自当前官方演示 CSS，而不是 Anthropic 对外发布的生产设计 token。
- **【可直接观察事实】** 对话、文件、diff、browser、terminal、plan、tasks 与 subagent 是同一 session 内可排列的 pane；pane 可拖动、调整大小、关闭，也可以并排打开两个 session。官方演示在页面容器小于 `1200px` 时隐藏 Preview，说明辅助 pane 会按空间退让，而不是无限压缩 transcript。
- **【可直接观察事实】** 默认 transcript 在 Normal / Verbose / Summary 之间调节工具细节；执行动作依赖动词、目标、增删数值、状态和缩进形成轨迹，不把每个动作包装成独立浮卡。
- **【可直接观察事实】** 工具摘要和文件名主要使用约 `14px`，正文约 `16px`，代码约 `13px`；中央正文依靠 sticky breadcrumb、任务、自然语言说明、工具摘要、展开证据、完成说明和 composer 形成层级，没有厚重顶栏。
- **【可直接观察事实】** 变更计数、Review code、tasks pane 与 CI status bar 在有对应内容或动作时出现；权限、模型与环境靠近 composer。右侧设置/Preview 内容主要直接铺在 pane 画布上，以分隔线组织，不再套一张大 Settings card。

#### Codex Desktop

- **【可直接观察事实】** 必须区分两个时期：独立 Codex app 于 **2026-02-02** 发布；自 **2026-07-09** 起，Codex 进入 ChatGPT desktop app，但保留面向开发工作的 project、chat、worktree、review 与 terminal 体验。历史发布素材适合判断稳定视觉哲学，当前功能与信息架构以合并后的官方文档为准。
- **【可直接观察事实】** OpenAI 2026-02-02 官方发布演示的静止帧显示：默认新 thread 是一块几乎完全连续的白色工作面。左侧窄 sidebar 使用文本行组织 New thread、Automations、Skills、近期线程和 repositories；主区顶部只有线程标题及少量 action，composer 靠近底部。演示帧保存于 `docs/research/codex-official-frame.png`。官方另提供[浅色产品截图](https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp)与[深色产品截图](https://learn.chatgpt.com/images/codex/app/codex-app-basic-dark.webp)。
- **【可直接观察事实】** sidebar 约占窗口宽度五分之一，是一块连续的冷蓝灰表面；New thread、Automations、Skills、projects/repositories 和 thread 都是紧凑列表行。thread 行用标题、running 点或 spinner、时间与增删数字承载状态，选中态只增加一层浅背景；project 不使用封面、头像或统计卡。
- **【可直接观察事实】** sidebar 同时承载两种密度：上部是轻量近期线程行，靠圆点、spinner、时间和短标题表达状态；下部 repositories 只使用小 folder glyph + 名称。两者都不是卡片。
- **【可直接观察事实】** composer 是一个主容器；模型、reasoning、附件、权限、语音与发送共用同一边界。Local / Worktree / Cloud 与 branch / repository 信息作为边界外的轻量上下文行，不再各自嵌套成第二层控件条。这一事实来自同一份官方演示的局部画面；本研究只保留完整官方帧 `docs/research/codex-official-frame.png`，不另存重复裁帧。
- **【可直接观察事实】** thread 执行态把探索和编辑压成普通文本行，例如 `Explored 1 file, 4 searches, 1 list` 与 `Edited page.tsx +3 -1`；最终总结和 `1 file changed` 结果块比中间工具轨迹更重，但仍留在同一连续页面中。
- **【可直接观察事实】** Create branch 等低频决策通过 modal 临时盖在 thread 上；review 与 terminal 由 pane/drawer 按需打开。Codex 默认保持一个绝对主工作面，只有检查代码或运行命令时才引入高密度证据面，不把 Preview、review 与 terminal 同时常驻。
- **【可直接观察事实】** 官方演示的产品身份主要来自一项结构色：略带冷蓝的 sidebar；主工作面、composer 和 modal 仍是中性白/灰。蓝色负责选择或运行，红绿只负责 diff，黑色负责主操作，没有全局强调色铺陈。

### 7.2 为什么它们看起来成熟

以下均为 **【设计推论】**：

1. **连续表面多，独立容器少。** 成熟感来自大工作面中的秩序，而不是给每组内容画一个圆角框。三栏可以同时存在，但 sidebar、transcript 与 Preview 各自已经是一级表面；普通工具行、设置组和 Changes 摘要不应再层层套卡。
2. **绝对主工作面始终只有一个。** Claude 可以在宽屏用三栏同时呈现 session、transcript 与 Preview，Codex 则更常以 conversation 为默认主面、按需打开 review/terminal。两者的共同点不是栏数，而是第三 pane 必须由当前任务触发并服务主线，不能成为常驻 dashboard。
3. **复杂度按任务阶段和窗口宽度出现。** 空态可以极稀疏；执行时增加轨迹；需要审查、预览或终端时打开对应 pane。桌面宽屏可以保留第三 pane，窄窗口则优先收起辅助 pane，而不是把三个工作面都压窄。
4. **密度允许有意不均。** sidebar 可高密、空态极低密、conversation 中密、review/terminal 高密；transcript 保持适合阅读的固定行长，右 pane 给真实证据足够面积。成熟界面不会为了视觉均衡把每个区域都填成相同密度。
5. **控件不是“展示设计”，而是“执行动作”。** 图标和按钮只在可操作位置出现；普通信息主要依赖排版、缩进、数值和分隔。按钮尺寸、轮廓和圆角不被用来制造热闹。
6. **同一事实只有一个视觉归属。** pane tab 是入口，pane 内容是结果；中栏已经列出的文件不必再在右栏摘要卡完整重复；当前 section 名也不应在二级导航和正文标题中以同等重量重复。
7. **身份来自一条持续规则。** Claude 是暖色 agent activity；Codex 是冷蓝 sidebar + 黑白工作面。两者都没有同时依赖渐变、头像、厚阴影、彩色卡片和大面积状态色。
8. **真实开发语义就是视觉内容。** 文件名、diff 数值、branch、worktree、命令、构建结果、权限和状态出现在它们实际影响流程的位置；这比泛化的 Crew dashboard、活动图表或抽象 progress 卡更具体，因此更不像模板。


### 7.3 三版 bingo 概念图的反 AI 味审查

审查对象：

- 当前参考驱动稿：`docs/concepts/bingo-claude-app-reference-driven.png`
- 当前融合稿：`docs/concepts/bingo-claude-codex-faithful.png`
- 上一版：`docs/concepts/bingo-app-concept-claude-codex.png`

#### 当前参考驱动稿：已经成立的部分

- **【观察】三栏比例不需要推翻。** 当前参考驱动稿 `1666 × 944` 的左/中/右约为 `19.0% / 44.2% / 36.8%`；Claude 官方参考约为 `22.4% / 44.2% / 32.9%`。中栏比例几乎完全一致，三栏也是官方 AppShell 的真实工作态，应保留为宽屏骨架。
- **【观察】** 中栏已具备用户任务、assistant 说明、工具摘要、展开 diff 与 composer 的正确顺序；问题不在工作流，而在每一层被统一做成了圆角组件。
- **【观察】** 左栏已经表达 Pinned / Scheduled / Recents，会话编排方向正确；右栏也确实承载了 Preview/Settings 与 Changes，这些都是有操作价值的工作上下文，而非纯装饰。

#### 当前参考驱动稿：仍然明显的生成式痕迹

- **【设计推论】右栏二次、三次包裹过多。** pane 内又有约 `576 × 553` 的 Settings 大卡，卡内再放二级导航和 segmented control；Changes 又成为第二张大卡。两卡合计约占屏高 `81%`，Settings 卡面积甚至约为中栏主 diff 的 `1.43×`，让辅助内容比主要工作结果更重。官方右栏则把设置行直接铺在 pane 画布上，以窄导航轨和分隔线建立秩序。
- **【设计推论】同一事实重复展示。** `Appearance` 同时作为二级导航选择和正文大标题；`Changes` 同时作为顶部 tab 与右下卡标题；三个 changed files 已在中栏工具结果出现，又在右栏完整列一遍。这不是信息密度，而是模型为了“显得完整”而维护同一事实的多种表示。
- **【设计推论】圆角包围面覆盖过度。** 当前稿至少约 31 个独立圆角表面，范围从顶栏按钮、左导航、session 行、用户消息、四条工具活动、diff、composer、model/Auto/Tools/Ready，到右栏 settings card、分段控件和 Changes card。问题不是统一换一组半径，而是大量元素根本不需要边界。
- **【设计推论】工具轨迹被统一卡片化。** Read 与三个 Edited 行都有图标、数量、chevron、描边和圆角；只有展开的 diff 真正需要容器。普通工具活动应首先是可扫描文本轨迹。
- **【设计推论】自然内容被强制齐成模板矩形。** 用户消息、diff 与 composer 基本共用同一左右边界；官方用户任务明显短于证据块和 composer，右缘自然参差，更像真实 transcript，而不是三张等宽卡片垂直堆叠。
- **【设计推论】图标用于逐行配图而非动作。** 8 条 Recents 各自被分配不同主题图标，Pinned 又同时显示左图标和右 pin，四条工具行重复 document glyph；与之相反，右栏顶栏虽有多枚视图图标，却缺少 `localhost:5173/settings` 一类更有价值的运行上下文。
- **【设计推论】白色 SaaS 模板感来自表面数量。** `#F8F8F8`、`#FAFAFA`、`#FEFEFE`、`#FFFFFF` 等近白材质层层叠加，再依靠 1px 边界与浅阴影区分；不是色值不够高级，而是窗口、pane、card、selected block、selected option 同时形成过多表面。

#### 当前融合稿：补充判断

- **【观察】** `bingo-claude-codex-faithful.png` 已从 workspace/crew 仪表盘回到 project → thread，并把右侧换成真实 Changes / diff，方向比上一版更接近开发工具。
- **【设计推论】** 它的问题同样不是三栏本身，而是为了在一张图中证明能力，同时展示四类工具、多个 Done、Running、terminal 输出、Changes 文件列表和完整 diff；右 pane 应只承担当前上下文，不能成为状态目录。
- **【设计推论】** header 与 composer 重复 Local / model / thinking，Read/Search/Edit/Bash 又同时使用左图标和右状态图标，仍然存在控件平均化和重复编码。

#### 上一版的主要问题

- **【观察】** Workspaces、Recent、Crew、Changes、Decisions、progress、timeline 与 composer 同时常驻，第一、二、三眼权重接近，属于典型 dashboard 功能墙。
- **【观察】** 高饱和渐变 New run、橙色进度条、发光感发送按钮与大量圆形人物/工具 glyph 同时出现，品牌色承担了导航、状态、进度和主动作四种职责。
- **【设计推论】** Crew 头像化、每一步圆节点化、各区均有 uppercase label 和分隔线，使界面像一套通用 agent SaaS 模板；它展示“多代理概念”，但没有展示 bingo 真实的 tool correlation、turn 边界、recoverable failure 或 CLI session 语义。

### 7.4 下一版生成硬约束

以下全部是 **【生成约束】**。除非所画状态明确需要，不得违反。

#### 结构与比例

1. **默认骨架是 sidebar + focused transcript；第三 pane 是上下文驱动的工作面。** 在宽屏且当前任务需要 Preview/Diff/Terminal/File/Plan/Tasks/Subagent 时，采用 Claude 式三栏，建议左 `20–22%`、中 `44–50%`、右 `30–34%`；没有证据面需求时采用 Codex 式单主面，不为了构图完整而占住空右栏。窄于约 `1200px` 时优先收起第三 pane。
2. **无论二面还是三栏，绝对主工作面只有一个。** transcript/conversation 是意图与叙事主线；右 pane 只能承载当前 Preview、Diff、Terminal、File、Plan、Tasks 或 Subagent 中的一类主上下文，可以切换但不得降级为摘要 dashboard，也不得在 pane 内纵向堆叠 Settings 与 Changes 大卡。
3. **中央 transcript 保持稳定阅读列。** 主正文最大宽度约 `680–760px`，左右留白约 `32–40px`；用户任务、自然语言说明、工具摘要、展开证据和 composer 按内容自然宽度排列，不强制所有块共用同一右缘。
4. **composer 只保留一个边界，宽度与主文本列一致。** composer 内最多显示 4 个常态 action/selector；其余收进 `+` 或 overflow。相同 provider/model/environment 不得在 header 与 composer 重复出现。

#### 容器与边界

5. **一级 pane 本身就是容器。** 除 composer、modal、展开后的代码/diff/terminal、用户输入语义块外，不给普通 tool event、session、setting group、file row 或 Changes 摘要添加独立 card。
6. **下一稿相对当前参考驱动稿至少删除一半包围面。** 当前粗数约 31 个；目标不超过 15 个可见圆角包围面，且右 pane 内最多 3 个。pill 只用于真实 selector、status 或短 action，不用于 section label。
7. **阴影只属于窗口与浮层。** sidebar、transcript、right pane、setting group 与普通 tool row 不用阴影；composer 至多使用极轻环境阴影或 1px 边界，二者不叠加。
8. **右 pane 通过背景、窄导航轨、文字层级和水平分隔组织。** 不再使用 `pane → Settings card → segmented shell → selected option shell` 的四层包裹。一级 section label 不超过 4 个。

#### 工具轨迹与状态

9. **默认工具轨迹用纯文本行。** 格式优先为“动作摘要 + 目标/数量 + 单一状态”；常态不同时显示左侧大图标和右侧状态图标。只有展开的 diff、terminal 输出、needs input 与 error 获得容器或强调。
10. **同一屏最多展示 4 个独立工具事件，且完成态允许合并。** 例如 `Read 4 files, searched the codebase`、`Edited theme.tsx +18 −2`；不得为了整齐把每条轨迹强制做成等宽卡片。
11. **状态色总面积低于界面面积的 2%。** accent 只负责 active/focus/running/primary action 中至多两类；success/warning/error 使用语义色与文字/形状双重编码。
12. **不得重复事实或伪造状态目录。** Appearance、Changes、changed files、provider/model/environment 各自只有一个权威呈现位置；一张图不要同时塞入 Done、Running、Queued、Blocked、Decision、Review、Diff、Terminal 全套状态。

#### 图标、字体与文案

13. **非系统窗口按钮外，可见图标控制在 12–16 个，且优先服务导航或动作。** Recents 不为每条任务创造主题图标；Pinned 不同时使用分组标题、左图标和右 pin 三重编码；重复工具类型不逐行配同一个装饰 glyph。
14. **类型角色最多 5 个：screen title、body、secondary、metadata、monospace。** screen title 不超过 body 的 1.5 倍；正文约 `15–16px`，工具摘要约 `13–14px`，代码约 `12–13px`，不用超大 hero 字。
15. **路径、branch、命令、模型 ID、diff 数值使用 monospace；正文与动作使用 UI sans。** 右 pane 顶栏优先显示 `localhost:5173/settings`、branch 或文件名等真实上下文，而不是用一排无说明图标代替信息。
16. **文案使用真实 bingo 语义。** 优先出现 turn、tool、session、provider、permission、recoverable error 等真实上下文；禁止 `Polishing interface`、`Agent working` 一类可替换到任意 agent 产品的泛化 copy。

#### 身份与反模板验收

17. **只选择一条 bingo 身份规则。** 推荐方向是把 bingo 的“结构化 CLI 事件流”转成极细的 turn/tool 状态节奏，例如每个 turn 只有一个低调起止标记，tool activity 通过同一条 baseline 组织；不要再增加头像、渐变、品牌大字或装饰网格。
18. **删除 logo 后仍须可识别为 coding agent workspace，而不是 SaaS dashboard。** 判断依据是 session orchestration、focused transcript、真实工具轨迹、composer，以及在当前任务需要时出现的 contextual pane，而不是固定栏数、颜色或品牌词。
19. **强制做减法复核。** 生成后依次问：第三 pane 是否有当前任务依据？能否拆掉右栏大卡？能否删除重复 Changes/Appearance？能否把普通工具卡还原为文本行？能否删掉逐行图标和重复配置？除“保留有依据的第三 pane”外，其余减法至少完成四项；目标是删除包裹与重复，不是机械追求二栏或三栏。
20. **拒收阈值。** 出现以下任一项即判失败：右 pane 内两张以上大卡纵向堆叠；6 个以上普通 tool/session 行卡片化；同一文件列表或 section 名出现两次；近白 card 套近白 card；全宽渐变主按钮；3 个以上头像/角色节点；同一配置在两个位置重复；超过两种高饱和强调色；为了填空出现无操作价值模块。

### 7.5 下一版首选构图

**【设计推论】** 下一版不应机械选择二栏或三栏，而应先确定画面所处的真实任务时刻。本稿已经明确表现 Preview/Settings，因此保留 Claude 式第三 pane 有充分依据；减法对象是包裹、重复和逐行装饰，而不是 pane 本身：

- 左侧约 `21%`：保留 session orchestration 与 Pinned / Scheduled / Recents；普通行使用重复的状态语法，不为每个任务创造主题图标，不再给整个导航套额外大卡。
- 中央约 `46%`：保留绝对主工作面 focused transcript；breadcrumb、用户任务、assistant 说明、文本工具轨迹、单个展开 diff 与 composer 依次出现。用户任务按内容自然收窄，工具行不再逐条卡片化。
- 右侧约 `33%`：由于本张图的任务确实需要 Preview/Settings，保留 contextual pane。顶栏显示 `localhost:5173/settings` 等真实上下文；设置项直接铺在 pane 画布上，以窄图标轨、文字层级和分隔线组织，不再出现 Settings 大卡和独立 Changes 摘要卡。
- Changes 作为 pane tab 或 header 中紧凑的 `3 files / +14 −3` 入口；切到 Changes 时，右栏内容整体替换为 review/diff，而不是在 Preview 下方再堆一张卡。
- 若下一张图表现普通 conversation、空态或不需要证据面的任务，应使用 Codex 式 sidebar + 单主面，并完全收起第三 pane；不要为了保持系列构图而保留空壳。
- bingo 的辨识度由“一条结构化 turn/tool baseline + 稀疏状态节奏”承担；品牌强调色只在当前运行点和 primary send/stop 上出现。

## 8. 结论

**【设计推论】** bingo 最值得借鉴的不是“像 Claude”或“像 Codex”的表皮，而是一种成熟 agent workspace 的共同骨架：**session 可编排、conversation/transcript 有绝对主线、工具可追溯、证据面按上下文出现、权限就地、细节渐进展开**。Claude 提供更好的“三栏工作态、执行轨迹与可组合 pane”参考，Codex 提供更好的“单主面默认值、项目/聊天秩序、Activity inbox 与按需审查”参考。

专项调研最终收敛为一个比“二栏还是三栏”更稳定的判断：**栏数由任务决定，AI 味来自卡片套卡片、重复事实、材质平均化和无依据的常驻模块。** 当前稿明确展示 Preview/Settings，且中栏比例与 Claude 官方参考几乎一致，因此下一版应保留有依据的三栏工作态，同时拆掉右栏二次包裹、删除重复的 Appearance/Changes/文件列表、把普通工具活动还原为文本轨迹。没有 Preview、Diff 或 Terminal 需求的画面则应采用 Codex 式单主面。bingo 的长期身份不应来自新的装饰，而应来自它最真实、也最不同于普通聊天产品的东西——**结构化 turn 与 tool 事件的可追溯节奏。**

## 9. 第一方来源清单

### Anthropic

- https://code.claude.com/docs/en/desktop
- https://code.claude.com/docs/en/desktop-quickstart
- https://code.claude.com/docs/en/claude-code-on-the-web
- https://code.claude.com/docs/en/desktop-scheduled-tasks
- https://claude.com/product/claude-code
- https://claude.com/download

### OpenAI

- https://openai.com/index/introducing-the-codex-app/
- https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp
- https://learn.chatgpt.com/images/codex/app/codex-app-basic-dark.webp
- https://learn.chatgpt.com/docs/whats-new
- https://learn.chatgpt.com/docs/projects
- https://learn.chatgpt.com/docs/code-review?surface=app
- https://learn.chatgpt.com/docs/integrated-terminal
- https://learn.chatgpt.com/docs/environments/git-worktrees
- https://learn.chatgpt.com/docs/permission-modes
- https://learn.chatgpt.com/docs/notifications
- https://learn.chatgpt.com/docs/automations
- https://learn.chatgpt.com/docs/long-running-work
- https://learn.chatgpt.com/docs/reference/settings
