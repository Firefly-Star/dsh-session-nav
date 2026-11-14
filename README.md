# dsh-session-nav

[中文](#中文) | [English](#english)

DSH（DeepSeek Harness）Web 侧栏增强插件：**点一下会话行，就能用方向键在会话之间跳转**。

侧栏里有几十个会话、分在十几个工作区里时，用鼠标一个个点太慢。这个插件让你像用 VSCode 的资源管理器一样，用键盘上下穿行。

> 纯客户端插件，没有 Host 半边：不注册路由、不存状态、不写任何文件。

## 中文

### 功能

| 操作 | 行为 |
|---|---|
| 点一下某个会话行 | 进入"导航上下文"，左下角出现提示条 |
| `↓` / `↑` | 下一个 / 上一个会话，**立刻切换** |
| `Home` / `End` | 第一个 / 最后一个会话 |
| `Esc` | 退出导航，键盘交还 |
| 在会话行以外点一下 | 退出导航 |
| 开始打字 | 立刻交还键盘（方向键恢复成光标移动） |

### 跨工作区

走到一个工作区的末尾继续按 `↓`，会自动展开下一个工作区 —— **但第一次按只展开，第二次按才进去**。

这是刻意的：折叠的工作区在 DOM 里一条会话行都没有，而浏览器的渲染不会在点击返回前完成。如果当场判断"空了就跳过"，就会把有会话的组误判成空组，于是出现"展开一下、立刻收起、再跳到下下个组"的怪现象。延后一次按键既避开了这个假象，也让"展开"这件事本身有可见反馈。

空的工作区（展开后确实一条会话都没有）会被自动收回，恢复它原来的折叠状态，并被跳过。

### 会话被截断时

一个工作区的会话太多时，原生侧栏只渲染前几条，剩下的收在 **"展开其余 N 个会话"** 里。导航遇到这种情况会先把它们展开再继续，不会把组内末尾的会话漏掉。

### 不打断输入

这是最容易做错的地方。DSH 打开会话后会把焦点抢回输入框，所以**不能用"焦点在哪里"判断该不该接管方向键** —— 那样第一次跳转后方向键就永久失效了。

插件只用你的**明确动作**作为让位信号：

- 开始打字（按了任何非导航键）
- 在会话行以外的地方点击（包括输入框）
- `Esc`
- 窗口失去焦点

此外，这些情况一律不接管：输入法正在合成（`isComposing`）、带 `Ctrl`/`Alt`/`Shift`/`Cmd` 修饰键、页面有弹窗（`[role="dialog"]`）、事件已被其他处理器 `preventDefault`。

侧栏折叠成 56px 图标轨道时没有会话行，导航自然不生效。

### 实现取向

**不复制原生的任何状态。** 展开工作区、展开"其余 N 个会话"、打开会话，全部通过点击原生 DOM 元素触发，跑的是 ui-workspace 自己的 `setGroupExpanded` 与 `openSession`。插件只读 `aria-expanded` / `aria-selected`，不持有折叠状态，也不写 `localStorage`，因此不会与原生侧栏不同步。

代价是依赖侧栏的 DOM 契约（`[role="tree"]`、`data-row-key="session:" / "workspace:" / "overflow:"`、`aria-expanded`、`aria-description`）。DSH 升级若改动这些，导航会失效 —— 但失效方式很温和：**找不到元素就什么都不做**，不会把状态搞坏。

已归档的会话（`aria-description` 非空）会被跳过，因为原生只允许它们在搜索里恢复。

### 安装

未发布到 npm，按 profile 从 GitHub 安装：

```powershell
dsh plugin --profile web add github:Firefly-Star/dsh-session-nav
```

或者手动：

```powershell
$dst = "$env:DSH_HOME\profiles\web\node_modules\dsh-session-nav"
git clone https://github.com/Firefly-Star/dsh-session-nav $dst
```

再把 `dsh-session-nav` 追加到 `$env:DSH_HOME\profiles\web\package.json` 的 `dsh.profile.bundles` 数组末尾，然后重启 DSH。

浏览器半边随页面刷新加载；Host 半边是空的，但 Loader 仍需要认出这一行。

> 请 profile 之后跑 `pnpm install` 会清掉手工放进 `node_modules` 的目录，需要重新复制。

### 组成

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：空实现，只为让 Loader 认领这一行 |
| `client.js` | 浏览器半：全部导航逻辑 |
| `cordis.patch.yml` | 随包分发的 profile 层，安装后自动挂载 |
| `assets/plugin-icon.svg` | 插件列表里的图标 |

### 兼容性

适配 DSH `0.2.0-rc.2` 的 Web 侧栏 DOM 契约。Windows / macOS / Linux 的浏览器端均适用（纯 DOM，无平台分支）。

## English

A DSH (DeepSeek Harness) sidebar enhancement: **click a session row, then use the arrow keys to move between sessions**.

With dozens of sessions spread across a dozen workspaces, clicking each one is slow. This plugin lets you walk the sidebar with the keyboard, like VSCode's file explorer.

> Browser-only: no host routes, no stored state, no files written.

### Keys

| Action | Behaviour |
|---|---|
| Click a session row | Enters navigation context; a hint appears bottom-left |
| `↓` / `↑` | Next / previous session, opening it immediately |
| `Home` / `End` | First / last session |
| `Esc` | Leave navigation, give the keyboard back |
| Click anywhere else | Leave navigation |
| Start typing | Give the keyboard back at once |

### Crossing workspaces

Pressing `↓` past the end of a workspace expands the next one — **the first press only expands, the second one enters**.

That two-step is deliberate. A collapsed workspace has no session rows in the DOM, and rendering does not finish before `click()` returns. Judging "empty, so skip" at that instant misreads populated groups as empty, which shows up as "expands, collapses again, jumps past it". Deferring one press avoids the false reading and gives the expansion visible feedback.

Genuinely empty workspaces (nothing at all after expanding) are collapsed back to their original state and skipped.

### Truncated groups

A workspace with many sessions renders only the first few, keeping the rest behind a **"show the other N sessions"** button. Navigation expands those before continuing, so the tail of a group is never skipped.

### Never fighting the text input

This is the part that is easy to get wrong. DSH pulls focus back to the composer after opening a session, so **"is the focused element an input?" cannot decide whether to take the arrow keys** — that would break navigation permanently after the first jump.

The plugin yields only on explicit user actions: typing any non-navigation key, clicking outside a session row (including the composer), `Esc`, or the window losing focus.

It also refuses to act while an IME composition is in progress, when a modifier is held, while a dialog is open, or when another handler already called `preventDefault`.

With the sidebar collapsed to its 56px rail there are no session rows, so navigation simply does nothing.

### Design stance

**No state is duplicated from the native sidebar.** Expanding a workspace, revealing truncated sessions and opening a session all happen by clicking the native DOM elements, so ui-workspace's own `setGroupExpanded` and `openSession` run. The plugin only reads `aria-expanded` / `aria-selected`; it keeps no expansion state and writes no `localStorage`, so it cannot drift from the real sidebar.

The cost is a dependency on the sidebar's DOM contract (`[role="tree"]`, `data-row-key` prefixes, `aria-expanded`, `aria-description`). A DSH upgrade that changes them disables navigation — but gracefully: **when nothing matches, nothing happens**, and no state is corrupted.

Archived sessions are skipped, since the native UI only lets them be restored from search.

### Install

Not published to npm; install from GitHub into a profile:

```powershell
dsh plugin --profile web add github:Firefly-Star/dsh-session-nav
```

Or by hand — clone into `$env:DSH_HOME\profiles\web\node_modules\dsh-session-nav`, append `dsh-session-nav` to `dsh.profile.bundles` in that profile's `package.json`, then restart DSH.

### Compatibility

Targets the DSH `0.2.0-rc.2` Web sidebar DOM contract. Pure DOM, no platform branches.

## License

MIT
