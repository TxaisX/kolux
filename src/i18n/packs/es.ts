// SET-017 (T-210-c): the Spanish pack. Machine-translated 2026-10-20 (Txais approved machine translation);
// a human review pass is in the after-list. Product names (Kolux, Claude, Codex, ChatGPT, Git) stay as they are.
import type { TextKey } from "../en";
import type { PackMeta } from "../packs";

export const META: PackMeta = { language: "es", machineTranslated: true, translatedOn: "2026-10-20", humanReviewed: false };

const pack = {
  "glossary.repository.plain": "proyecto",
  "glossary.repository.hover": "Aquí un proyecto es una carpeta que Git sigue (un repositorio de Git)",
  "glossary.clone.plain": "Copiar desde una dirección web",
  "glossary.clone.hover": "Copiar desde una dirección web: git clone descarga un repositorio de Git desde su URL",
  "glossary.worktree.plain": "espacio de trabajo",
  "glossary.worktree.hover": "Un espacio de trabajo es una rama en su propia carpeta (un worktree de Git)",
  "glossary.checkout.plain": "carpeta principal",
  "glossary.checkout.hover": "La carpeta principal del proyecto (su checkout principal)",
  "glossary.shell.plain": "terminal",
  "glossary.shell.hover": "Una terminal: un shell simple, sin IA dentro",
  "glossary.cli.plain": "programa",
  "glossary.cli.hover": "El programa propio de la IA en este PC (su CLI)",
  "glossary.pty.plain": "terminal",
  "glossary.pty.hover": "Una terminal (un PTY, o pseudoterminal)",
  "inbox.bell.needs.one": "Bandeja de entrada, {count} te necesita",
  "inbox.bell.needs.many": "Bandeja de entrada, {count} te necesitan",
  "connect.claude": "Conectar abre una vez la página de inicio de sesión de Claude en tu navegador y guarda una clave que dura un año.",
  "connect.codex": "Conectar añade una cuenta de ChatGPT en un directorio de Codex propio de Kolux; tu carpeta de Codex no cambia.",
  "onboarding.connect.wait": "Conecta una IA arriba para continuar, o usa el botón de la izquierda para hacerlo más tarde.",
  "sleep.asleep": "Dormido para ahorrar memoria · inactivo {count} min",
  "sleep.asleep.hint": "Despertar inicia de nuevo el mismo agente donde lo dejó.",
  "sleep.wake": "Despertar",
  "sleep.settings.card": "Experimental",
  "sleep.settings.switch": "Suspensión de agentes",
  "sleep.settings.detail": "Apagado: nada cambia. Encendido: un panel de agente que terminó su turno y quedó sin tocar durante el tiempo elegido se duerme: su sesión se guarda y su programa termina, lo que libera memoria. El panel sigue en su sitio y Despertar devuelve el mismo agente donde lo dejó. Un panel que está trabajando, espera tu respuesta, tiene texto sin enviar o es el que estás mirando nunca se duerme.",
  "sleep.settings.minutes": "Minutos inactivo antes de dormir",
} satisfies Record<TextKey, string>;

export default pack;
