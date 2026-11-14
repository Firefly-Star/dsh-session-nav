//#region lib/types/index.js
/**
 * Host half of dsh-session-nav.
 *
 * 导航完全发生在浏览器里（监听 keydown / pointerdown，复用侧栏原生的 DOM 行为），
 * 所以 Host 侧没有任何状态、路由或服务要提供 —— 这个入口只负责让 Loader 认领这一行，
 * 并把 package.json 里 `dsh.client` 声明的浏览器半边挂上去。
 */

/** Loader entry: the browser half is mounted through the package's client declaration. */
function apply() {}
//#endregion

export { apply };
