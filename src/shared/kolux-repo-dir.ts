// Why: repos written before the Nightshift->Kolux rename keep their content under .nightshift/;
// read it as a fallback (issue-command, templates) so existing repos keep working. New writes
// always go to .kolux/.
export const KOLUX_REPO_DIR_NAME = '.kolux'
export const LEGACY_NIGHTSHIFT_REPO_DIR_NAME = '.nightshift'
