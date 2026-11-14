/**
 * dsh-session-nav — Client half.
 *
 * 点一下侧栏的会话行，就能用方向键在会话间跳转。跨工作区时会自动展开下一个工作区。
 *
 * 交互（VSCode 侧栏 / 资源管理器的套路）：
 *   1) 鼠标点一下某个会话行 → 进入"导航上下文"（armed），左下角出现提示条
 *   2) armed 期间：↑ / ↓ 上下切换会话；Home / End 去首 / 尾
 *   3) 跨工作区：到组边界时先展开下一个工作区，**再按一次**才进去
 *   4) 组内被"展开其余 N 个会话"截断时，先展开再继续，不漏掉末尾
 *   5) Esc 退出；点别处（含输入框）也退出；开始打字立即交还键盘
 *   6) 有弹窗、输入法合成中、带修饰键、已被别的处理器 preventDefault —— 一律不接管
 *
 * 为什么不靠"焦点在哪里"判断：DSH 打开会话后会把焦点抢回 input 输入框，
 * 若把"焦点在输入框"当让位信号，方向键会在第一次跳转后永久失效。
 * 所以让位信号只用用户的明确动作：打字，或点了会话行以外的地方。
 *
 * 为什么要等一次按键才进新展开的组：折叠的工作区在 DOM 里没有会话行，而
 * click() 触发的 React 更新不会在 click() 返回前完成 —— 那一刻读到的必然是
 * 0 行，同步判空会把有会话的组误判成空组。延后一次按键既避开了这个假象，
 * 也让"展开"这件事本身有可见反馈。
 *
 * 一切展开/跳转都复用原生 DOM 行为（工作区行与"展开其余"按钮的点击）。
 * 本插件不持有任何折叠状态，也不写 localStorage，因此不会与原生侧栏不同步。
 *
 * 已归档行（aria-description 非空）与零高度行自动跳过。
 * 侧栏折叠成 56px 轨道时没有会话行，导航自然不生效。
 */
window.__ModuleLoader__.load({
	id: "dsh-session-nav",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const NS = "dsh-session-nav";

		const ROW_SEL = '[role="tree"] [data-row-key^="session:"]';
		const WORKSPACE_SEL = '[data-row-key^="workspace:"]';
		const OVERFLOW_SEL = '[data-row-key^="overflow:"]';
		const NAV_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

		/* ---- 词典：GUI 语言决定用哪一份 ---- */
		const zh = {
			"badge.hint": "方向键导航 · ↑↓ 切换 · Esc 退出"
		};
		const en = {
			"badge.hint": "Arrow-key navigation · ↑↓ switch · Esc to exit"
		};

		const BASE_CSS = [
			".dsn-badge{position:fixed;left:12px;bottom:56px;z-index:2147483000;padding:5px 10px;border-radius:8px;",
			"font:12px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.02em;color:#fff;",
			"background:rgba(28,28,30,.88);box-shadow:0 6px 24px rgba(0,0,0,.24);backdrop-filter:blur(8px);",
			"pointer-events:none;opacity:0;transition:opacity .16s ease;}",
			".dsn-badge[data-visible='true']{opacity:1;}"
		].join("");

		/**
		 * 整套导航逻辑。所有状态都封在这一个闭包里，由 apply() 创建、由 ctx.effect 释放。
		 * @param ctx - client cordis context（提供 locale 与 effect）
		 * @returns 释放函数
		 */
		function install(ctx) {
			const t = ctx.locale.bind(NS);

			let armed = false;
			let badge = null;
			/** 最近一次导航到的会话 id，用于"当前选中项不在 DOM 里"时兜底。 */
			let anchorId = null;
			/**
			 * 已展开某个组、但行还没渲染出来时记在这里（第一下只展开、第二下才进）。
			 * @type {{ key: string, direction: number } | null}
			 */
			let pending = null;
			/**
			 * 上次按键点了"展开其余 N 个会话"，本次按键优先回这个组看新行。
			 * `from` 是展开前所在的那条会话，用来从它后面继续。
			 */
			let resumeGroup = null;
			/**
			 * 已确认是空的工作区（展开后一条会话都没有）。直接跳过，避免在空组间往返。
			 */
			const emptyKeys = new Set();

			const tree = () => document.querySelector('[role="tree"]');

			const isVisible = (el) => {
				const rect = el.getBoundingClientRect();
				return rect.height > 0 && rect.width > 0;
			};

			/** 归档行不可打开（原生只会给 toast），导航时跳过。 */
			const isArchived = (el) => el.getAttribute("aria-description") !== null;

			/** 树里的工作区分组，按显示顺序（tree 的直接子节点）。 */
			const groups = () => {
				const root = tree();
				if (root === null) return [];
				return [...root.children]
					.map((section) => {
						const row = section.querySelector(WORKSPACE_SEL);
						if (row === null) return null;
						return {
							section,
							row,
							expanded: () => row.getAttribute("aria-expanded") === "true"
						};
					})
					.filter((group) => group !== null);
			};

			/** 组内已渲染且可打开的会话行（按显示顺序）。 */
			const sessionsOf = (group) =>
				[...group.section.querySelectorAll('[data-row-key^="session:"]')].filter(
					(el) => !isArchived(el) && isVisible(el)
				);

			const overflowOf = (group) => group.section.querySelector(OVERFLOW_SEL);

			const groupKeyOf = (group) => group.row.dataset.rowKey || "";

			/**
			 * 点一次"展开其余 N 个会话"。
			 *
			 * 刻意**不等待**任何异步信号：React 的重新渲染可能晚于本帧，也可能因为页面
			 * 不可见而延后。做法是点一次就返回，把等待交给下一次按键 —— 按键因此永远
			 * 有立即反馈，不会出现"按了没反应"。
			 * @returns 是否点了（不代表本帧已渲染）
			 */
			const revealOnce = (group) => {
				const button = overflowOf(group);
				if (button === null) return false;
				button.click();
				return true;
			};

			/** 打开一个会话行：滚动到可见，然后复用原生点击逻辑。 */
			const openRow = (row) => {
				if (row === null || row === undefined) return false;
				row.scrollIntoView({ block: "nearest" });
				row.click();
				anchorId = (row.dataset.rowKey || "").slice("session:".length);
				renderBadge();
				return true;
			};

			/**
			 * 定位当前所在位置：先按本次导航记下的 anchorId 找，再退回 DOM 的 aria-selected。
			 *
			 * anchorId 必须优先：React 更新 aria-selected 有延迟，连续快速按键时 DOM 还停在
			 * 上一条，用它算"下一个"就会来回跳。anchorId 是我们自己刚点过的那一条，永远最新。
			 */
			const locate = (list) => {
				if (anchorId !== null) {
					for (let gi = 0; gi < list.length; gi += 1) {
						const rows = sessionsOf(list[gi]);
						const si = rows.findIndex(
							(el) => (el.dataset.rowKey || "").slice("session:".length) === anchorId
						);
						if (si >= 0) return { gi, si, rows };
					}
				}
				for (let gi = 0; gi < list.length; gi += 1) {
					const rows = sessionsOf(list[gi]);
					const si = rows.findIndex((el) => el.getAttribute("aria-selected") === "true");
					if (si >= 0) return { gi, si, rows };
				}
				return null;
			};

			/**
			 * 展开一个折叠的工作区。
			 *
			 * 借用原生触发器：点工作区标题行走的是 ui-workspace 自己的 onClick →
			 * setGroupExpanded，状态与重渲染都由原生负责，本插件不持有一份折叠状态。
			 * 注意工作区行的点击是 **toggle**，所以只在确认折叠时才点。
			 */
			const expandGroup = (group) => {
				if (group.expanded()) return true;
				group.row.click();
				return true;
			};

			const clearPending = () => {
				pending = null;
				resumeGroup = null;
			};

			/**
			 * 落地 pending：上次按键展开了某个组，现在回来看它到底有没有会话。
			 * @returns 是否已经消费掉这次 pending
			 */
			const settlePending = () => {
				if (pending === null) return false;
				const { key, direction } = pending;
				pending = null;
				const list = groups();
				const group = list.find((item) => groupKeyOf(item) === key);
				if (group === undefined) return false;
				const rows = sessionsOf(group);
				if (rows.length > 0) {
					openRow(direction > 0 ? rows[0] : rows[rows.length - 1]);
					return true;
				}
				/* 展开后确实没有会话：这是空工作区。收回它，恢复用户原来的折叠状态，
				   并记下来，避免下次按键又在这里重来。 */
				emptyKeys.add(key);
				if (group.expanded()) group.row.click();
				return true;
			};

			/**
			 * 落地 resumeGroup：上次按键点了"展开其余 N 个会话"。
			 * @returns 是否已经处理并完成了一次导航
			 */
			const settleResume = () => {
				if (resumeGroup === null) return false;
				const { key, from } = resumeGroup;
				resumeGroup = null;
				const list = groups();
				const group = list.find((item) => groupKeyOf(item) === key);
				if (group === undefined) return false;
				const rows = sessionsOf(group);
				const base =
					from === null
						? -1
						: rows.findIndex((el) => (el.dataset.rowKey || "").slice("session:".length) === from);
				/* 展开后新行通常在原位置之后 */
				if (base >= 0 && base + 1 < rows.length) {
					openRow(rows[base + 1]);
					return true;
				}
				/* 原行已经不在 DOM（被虚拟化），退化为按当前定位继续 */
				if (rows.length > 0) {
					const still = locate(list);
					if (still !== null && still.gi === list.indexOf(group) && still.si + 1 < rows.length) {
						openRow(rows[still.si + 1]);
						return true;
					}
				}
				/* 本组还有没展开的会话：继续展开，**不要**跨组跳过它们 */
				if (overflowOf(group) !== null) {
					revealOnce(group);
					resumeGroup = { key, from: anchorId };
					return true;
				}
				return false;
			};

			/**
			 * 从 fromIndex 起向后（+1）或向前（-1）找下一个有会话的组并进去。
			 * @param list - 当前的工作区分组
			 * @param fromIndex - 起点（不含）
			 * @param direction - +1 向下，-1 向上
			 * @returns 是否已经完成一次导航
			 */
			const enterNextGroup = (list, fromIndex, direction) => {
				const stepSize = direction > 0 ? 1 : -1;
				for (let gi = fromIndex; gi >= 0 && gi < list.length; gi += stepSize) {
					const group = list[gi];
					const key = groupKeyOf(group);
					/* 已知空的工作区：直接跳过，不再展开浪费时间 */
					if (emptyKeys.has(key)) continue;
					if (!group.expanded()) {
						/* 折叠组：**只展开，不进去**（第一下展开、第二下才进）。
						   这里绝不能读 sessionsOf() 判空 —— 展开那一帧它必然还是 0 行。 */
						expandGroup(group);
						pending = { key, direction };
						return true;
					}
					const rows = sessionsOf(group);
					if (rows.length === 0) {
						emptyKeys.add(key);
						continue;
					}
					if (direction > 0) {
						openRow(rows[0]);
					} else {
						/* 向上进入一个组时落到它"真正的最后一条"：截断的组要先展开其余会话 */
						if (overflowOf(group) !== null) {
							revealOnce(group);
							const grown = sessionsOf(group);
							openRow(grown[grown.length - 1]);
						} else {
							openRow(rows[rows.length - 1]);
						}
					}
					return true;
				}
				return false;
			};

			/** 向下走一步。语义：每次按键最多推进一个会话，绝不等待。 */
			const down = () => {
				if (settlePending()) return;
				if (settleResume()) return;
				const list = groups();
				if (list.length === 0) return;
				const at = locate(list);

				if (at !== null) {
					const group = list[at.gi];
					const rows = sessionsOf(group);
					if (at.si + 1 < rows.length) {
						openRow(rows[at.si + 1]);
						return;
					}
					/* 组内被"展开其余 N 个会话"截断：点一次展开，下次按键从这里续上 */
					if (overflowOf(group) !== null) {
						revealOnce(group);
						resumeGroup = { key: groupKeyOf(group), from: anchorId };
						return;
					}
					enterNextGroup(list, at.gi + 1, 1);
					return;
				}

				enterNextGroup(list, 0, 1);
			};

			/**
			 * 向上走一步。与 down 对称，但进入一个组时落到它"真正的最后一条"：
			 * 被截断的组要先展开其余会话，否则会停在中间。
			 */
			const up = () => {
				if (settlePending()) return;
				resumeGroup = null;
				const list = groups();
				if (list.length === 0) return;
				const at = locate(list);

				if (at !== null) {
					const rows = sessionsOf(list[at.gi]);
					if (at.si > 0) {
						openRow(rows[at.si - 1]);
						return;
					}
					enterNextGroup(list, at.gi - 1, -1);
					return;
				}

				enterNextGroup(list, list.length - 1, -1);
			};

			/** Home：一路向下扫到第一个能进入的会话。 */
			const first = () => {
				clearPending();
				emptyKeys.clear();
				enterNextGroup(groups(), 0, 1);
			};

			/** End：一路向上扫到最后一个能进入的会话。 */
			const last = () => {
				clearPending();
				emptyKeys.clear();
				const list = groups();
				enterNextGroup(list, list.length - 1, -1);
			};

			/* ---- 状态提示条：让人看见"现在键盘归导航" ---- */
			const ensureBadge = () => {
				if (badge !== null && badge.isConnected) return badge;
				badge = document.createElement("div");
				badge.className = "dsn-badge";
				badge.setAttribute("role", "status");
				badge.setAttribute("aria-live", "polite");
				badge.textContent = t("badge.hint");
				document.body.appendChild(badge);
				return badge;
			};

			const renderBadge = () => {
				if (!armed) return;
				const el = ensureBadge();
				el.setAttribute("data-visible", "true");
			};

			const hideBadge = () => {
				if (badge !== null) badge.removeAttribute("data-visible");
			};

			const arm = () => {
				armed = true;
				renderBadge();
			};

			const releaseFocus = () => {
				armed = false;
				hideBadge();
			};

			/* ---- 事件 ---- */
			const onPointerDown = (event) => {
				const target = event.target instanceof Element ? event.target.closest(ROW_SEL) : null;
				if (target === null) {
					/* 点了会话行以外的地方（含输入框）：交还键盘 */
					releaseFocus();
					return;
				}
				/* 点在行内按钮（…菜单、归档图标）上时，不当作"选中这一行" */
				if (event.target instanceof Element && event.target.closest("button") !== null) {
					releaseFocus();
					return;
				}
				arm();
			};

			const onKeyDown = (event) => {
				if (!armed) return;

				/* Esc 退出是最高优先级意图，先于一切让位判断 */
				if (event.key === "Escape") {
					if (event.isComposing) return;
					releaseFocus();
					event.preventDefault();
					event.stopPropagation();
					return;
				}

				/* 打字即让位：按了任何非导航键，说明用户在输入，交还键盘 */
				if (!NAV_KEYS.includes(event.key)) {
					if (!event.ctrlKey && !event.metaKey && !event.altKey) releaseFocus();
					return;
				}

				if (event.defaultPrevented) return;
				if (event.isComposing) return;
				if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
				if (document.querySelector('[role="dialog"],[role="alertdialog"]') !== null) return;

				/* 侧栏折叠成轨道时没有会话行，自然什么都不做 */
				if (groups().length === 0) return;

				event.preventDefault();
				event.stopPropagation();

				/* 全部同步执行：不排队、不等待，每次按键立刻产生可见结果 */
				switch (event.key) {
					case "ArrowDown":
						down();
						break;
					case "ArrowUp":
						up();
						break;
					case "Home":
						first();
						break;
					case "End":
						last();
						break;
				}
			};

			const onBlur = () => releaseFocus();

			document.addEventListener("pointerdown", onPointerDown, true);
			window.addEventListener("keydown", onKeyDown, true);
			window.addEventListener("blur", onBlur);

			return () => {
				document.removeEventListener("pointerdown", onPointerDown, true);
				window.removeEventListener("keydown", onKeyDown, true);
				window.removeEventListener("blur", onBlur);
				if (badge !== null) badge.remove();
				badge = null;
			};
		}

		function apply(ctx) {
			/* 样式只装一次；同 id 已存在就复用（插件重载时会走这里） */
			if (typeof document !== "undefined" && document.head !== null) {
				const attribute = "data-plugin";
				if (document.head.querySelector(`style[${attribute}="${NS}"]`) === null) {
					const style = document.createElement("style");
					style.setAttribute(attribute, NS);
					style.textContent = BASE_CSS;
					document.head.appendChild(style);
					ctx.effect(() => () => style.remove(), `${NS}: styles`);
				}
			}

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);

			/* 导航本身不渲染 React 树，但必须跟着插件生命周期装卸，所以整体包在 ctx.effect 里：
			   插件卸载时一次性摘掉监听器与提示条。 */
			ctx.effect(() => install(ctx), `${NS}: navigation`);
		}

		exports.apply = apply;
		exports.inject = ["locale"];
		return module.exports;
	}
});
