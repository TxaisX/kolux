// SET-017 (T-210-c): the Simplified Chinese pack. Machine-translated 2026-10-20 (Txais approved machine translation);
// a human review pass is in the after-list. Product names (Kolux, Claude, Codex, ChatGPT, Git) stay as they are.
import type { TextKey } from "../en";
import type { PackMeta } from "../packs";

export const META: PackMeta = { language: "zh-CN", machineTranslated: true, translatedOn: "2026-10-20", humanReviewed: false };

const pack = {
  "glossary.repository.plain": "项目",
  "glossary.repository.hover": "这里的项目是 Git 跟踪的文件夹（Git 仓库）",
  "glossary.clone.plain": "从网址复制",
  "glossary.clone.hover": "从网址复制：git clone 会从网址下载 Git 仓库",
  "glossary.worktree.plain": "工作区",
  "glossary.worktree.hover": "工作区是位于独立文件夹中的分支（Git worktree）",
  "glossary.checkout.plain": "主文件夹",
  "glossary.checkout.hover": "项目的主文件夹（即主检出）",
  "glossary.shell.plain": "终端",
  "glossary.shell.hover": "终端：不含 AI 的普通 shell",
  "glossary.cli.plain": "程序",
  "glossary.cli.hover": "AI 在这台电脑上的专属程序（即 CLI）",
  "glossary.pty.plain": "终端",
  "glossary.pty.hover": "终端（PTY，即伪终端）",
  "inbox.bell.needs.one": "收件箱，{count} 项需要你处理",
  "inbox.bell.needs.many": "收件箱，{count} 项需要你处理",
  "connect.claude": "点击“连接”会在浏览器中打开一次 Claude 的登录页面，并保存一个有效期为一年的密钥。",
  "connect.codex": "点击“连接”会在 Kolux 专属的 Codex 目录中添加一个 ChatGPT 账户；你的 Codex 文件夹保持不变。",
  "onboarding.connect.wait": "请先在上方连接一个 AI 才能继续，或用左侧的按钮稍后再设置。",
  "sleep.asleep": "已休眠以节省内存 · 空闲 {count} 分钟",
  "sleep.asleep.hint": "点“唤醒”会让同一个 AI 从停下的地方继续。",
  "sleep.wake": "唤醒",
  "sleep.settings.card": "实验功能",
  "sleep.settings.switch": "AI 休眠",
  "sleep.settings.detail": "关闭：一切照旧。开启：一个已完成回答、并在所选时间内未被触碰的 AI 窗格会进入休眠：保存会话并结束其程序，从而释放内存。窗格留在原处，点“唤醒”同一个 AI 会从停下的地方回来。正在工作、等待你回答、有未发送文字或你正在查看的窗格永不休眠。",
  "sleep.settings.minutes": "休眠前的空闲分钟数",
} satisfies Record<TextKey, string>;

export default pack;
