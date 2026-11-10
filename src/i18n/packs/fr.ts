// SET-017 (T-210-c): the French pack. Machine-translated 2026-10-20 (Txais approved machine translation);
// a human review pass is in the after-list. Product names (Kolux, Claude, Codex, ChatGPT, Git) stay as they are.
import type { TextKey } from "../en";
import type { PackMeta } from "../packs";

export const META: PackMeta = { language: "fr", machineTranslated: true, translatedOn: "2026-10-20", humanReviewed: false };

const pack = {
  "glossary.repository.plain": "projet",
  "glossary.repository.hover": "Un projet est ici un dossier suivi par Git (un dépôt Git)",
  "glossary.clone.plain": "Copier depuis une adresse web",
  "glossary.clone.hover": "Copier depuis une adresse web : git clone télécharge un dépôt Git depuis son URL",
  "glossary.worktree.plain": "espace de travail",
  "glossary.worktree.hover": "Un espace de travail est une branche dans son propre dossier (un worktree Git)",
  "glossary.checkout.plain": "dossier principal",
  "glossary.checkout.hover": "Le dossier principal du projet (son checkout principal)",
  "glossary.shell.plain": "terminal",
  "glossary.shell.hover": "Un terminal : un shell simple, sans IA dedans",
  "glossary.cli.plain": "programme",
  "glossary.cli.hover": "Le programme propre à l'IA sur ce PC (sa CLI)",
  "glossary.pty.plain": "terminal",
  "glossary.pty.hover": "Un terminal (un PTY, ou pseudo-terminal)",
  "inbox.bell.needs.one": "Boîte de réception, {count} a besoin de vous",
  "inbox.bell.needs.many": "Boîte de réception, {count} ont besoin de vous",
  "connect.claude": "Se connecter ouvre une fois la page de connexion de Claude dans votre navigateur et conserve une clé valable un an.",
  "connect.codex": "Se connecter ajoute un compte ChatGPT dans un dossier Codex propre à Kolux ; votre dossier Codex reste inchangé.",
  "onboarding.connect.wait": "Connectez une IA ci-dessus pour continuer, ou utilisez le bouton de gauche pour le faire plus tard.",
  "sleep.asleep": "En veille pour libérer de la mémoire · inactif {count} min",
  "sleep.asleep.hint": "Réveiller relance le même agent là où il s’était arrêté.",
  "sleep.wake": "Réveiller",
  "sleep.settings.card": "Expérimental",
  "sleep.settings.switch": "Veille des agents",
  "sleep.settings.detail": "Désactivé : rien ne change. Activé : un volet d’agent qui a fini son tour et n’a pas été touché pendant le délai choisi est mis en veille : sa session est enregistrée et son programme se termine, ce qui libère de la mémoire. Le volet reste en place et Réveiller ramène le même agent là où il s’était arrêté. Un volet qui travaille, attend votre réponse, contient un texte non envoyé ou est celui que vous regardez ne se met jamais en veille.",
  "sleep.settings.minutes": "Minutes d’inactivité avant la veille",
} satisfies Record<TextKey, string>;

export default pack;
