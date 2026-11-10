// SET-017 (T-210-c): the Korean pack. Machine-translated 2026-10-20 (Txais approved machine translation);
// a human review pass is in the after-list. Product names (Kolux, Claude, Codex, ChatGPT, Git) stay as they are.
import type { TextKey } from "../en";
import type { PackMeta } from "../packs";

export const META: PackMeta = { language: "ko", machineTranslated: true, translatedOn: "2026-10-20", humanReviewed: false };

const pack = {
  "glossary.repository.plain": "프로젝트",
  "glossary.repository.hover": "여기서 프로젝트는 Git이 추적하는 폴더입니다(Git 저장소)",
  "glossary.clone.plain": "웹 주소에서 복사",
  "glossary.clone.hover": "웹 주소에서 복사: git clone은 URL에서 Git 저장소를 내려받습니다",
  "glossary.worktree.plain": "작업 공간",
  "glossary.worktree.hover": "작업 공간은 자체 폴더에 있는 브랜치입니다(Git worktree)",
  "glossary.checkout.plain": "기본 폴더",
  "glossary.checkout.hover": "프로젝트의 기본 폴더(메인 체크아웃)",
  "glossary.shell.plain": "터미널",
  "glossary.shell.hover": "터미널: AI가 들어 있지 않은 일반 셸입니다",
  "glossary.cli.plain": "프로그램",
  "glossary.cli.hover": "이 PC에 있는 AI 전용 프로그램(CLI)",
  "glossary.pty.plain": "터미널",
  "glossary.pty.hover": "터미널(PTY, 즉 의사 터미널)",
  "inbox.bell.needs.one": "받은편지함, {count}건이 확인을 기다립니다",
  "inbox.bell.needs.many": "받은편지함, {count}건이 확인을 기다립니다",
  "connect.claude": "연결을 누르면 브라우저에서 Claude 로그인 페이지가 한 번 열리고, 1년간 유효한 키가 저장됩니다.",
  "connect.codex": "연결을 누르면 Kolux 전용 Codex 홈에 ChatGPT 계정이 추가됩니다. 기존 Codex 폴더는 그대로 유지됩니다.",
  "onboarding.connect.wait": "계속하려면 위에서 AI를 연결하거나, 왼쪽 버튼으로 나중에 하세요.",
  "sleep.asleep": "메모리를 아끼기 위해 잠자는 중 · {count}분 유휴",
  "sleep.asleep.hint": "깨우기를 누르면 같은 에이전트가 멈춘 곳에서 다시 시작됩니다.",
  "sleep.wake": "깨우기",
  "sleep.settings.card": "실험적 기능",
  "sleep.settings.switch": "에이전트 잠자기",
  "sleep.settings.detail": "꺼짐: 아무것도 바뀌지 않습니다. 켜짐: 응답을 마치고 선택한 시간 동안 손대지 않은 에이전트 창을 잠자기 상태로 둡니다. 세션을 저장하고 프로그램을 끝내 메모리를 확보합니다. 창은 그 자리에 남고 깨우기를 누르면 같은 에이전트가 멈춘 곳에서 돌아옵니다. 작업 중이거나, 답을 기다리거나, 보내지 않은 글이 있거나, 지금 보고 있는 창은 절대 잠자지 않습니다.",
  "sleep.settings.minutes": "잠자기 전 유휴 시간(분)",
} satisfies Record<TextKey, string>;

export default pack;
