// SET-017 (T-210-c): the Japanese pack. Machine-translated 2026-10-20 (Txais approved machine translation);
// a human review pass is in the after-list. Product names (Kolux, Claude, Codex, ChatGPT, Git) stay as they are.
import type { TextKey } from "../en";
import type { PackMeta } from "../packs";

export const META: PackMeta = { language: "ja", machineTranslated: true, translatedOn: "2026-10-20", humanReviewed: false };

const pack = {
  "glossary.repository.plain": "プロジェクト",
  "glossary.repository.hover": "ここでのプロジェクトは、Git が管理するフォルダです（Git リポジトリ）",
  "glossary.clone.plain": "Web アドレスからコピー",
  "glossary.clone.hover": "Web アドレスからコピー：git clone は、URL から Git リポジトリをダウンロードします",
  "glossary.worktree.plain": "ワークスペース",
  "glossary.worktree.hover": "ワークスペースは、専用のフォルダにあるブランチです（Git worktree）",
  "glossary.checkout.plain": "メインフォルダ",
  "glossary.checkout.hover": "プロジェクトのメインフォルダ（メインのチェックアウト）",
  "glossary.shell.plain": "ターミナル",
  "glossary.shell.hover": "ターミナル：AI の入っていない、ふつうのシェルです",
  "glossary.cli.plain": "プログラム",
  "glossary.cli.hover": "この PC 上にある AI 専用のプログラム（CLI）",
  "glossary.pty.plain": "ターミナル",
  "glossary.pty.hover": "ターミナル（PTY、つまり疑似端末）",
  "inbox.bell.needs.one": "受信トレイ、{count} 件があなたを待っています",
  "inbox.bell.needs.many": "受信トレイ、{count} 件があなたを待っています",
  "connect.claude": "「接続」を押すと、ブラウザーで Claude のサインインページが一度開き、1 年間有効なキーが保存されます。",
  "connect.codex": "「接続」を押すと、Kolux 専用の Codex ホームに ChatGPT アカウントが追加されます。お使いの Codex フォルダはそのまま変わりません。",
  "onboarding.connect.wait": "続けるには上で AI をつなぐか、左のボタンであとで設定してください。",
  "sleep.asleep": "メモリ節約のためスリープ中 · {count} 分アイドル",
  "sleep.asleep.hint": "「起こす」で同じエージェントを中断したところから再開します。",
  "sleep.wake": "起こす",
  "sleep.settings.card": "試験的な機能",
  "sleep.settings.switch": "エージェントのスリープ",
  "sleep.settings.detail": "オフ: 何も変わりません。オン: 応答を終えて選んだ時間のあいだ触られなかったエージェントのペインをスリープさせます。セッションを保存してプログラムを終了し、メモリを空けます。ペインはそのまま残り、「起こす」で同じエージェントが中断したところから戻ります。作業中、あなたの返事を待っている、未送信の文章がある、いま見ているペインはスリープしません。",
  "sleep.settings.minutes": "スリープまでのアイドル時間（分）",
} satisfies Record<TextKey, string>;

export default pack;
