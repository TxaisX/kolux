// T-653: the listener of the automatic pull request flow. When an agent finishes a turn it loads
// autoPr.ts on demand and hands the folder over. The window loads this file itself on demand, from
// an effect after mount (App.tsx: `import("./scm/autoPrWatch")`), so the first load grows only by
// the loader. A turn that finishes before this file has loaded is not heard (`onFinish` keeps no
// backlog); the next finished turn commits its changes too.
import { onFinish } from "../status/finished";

onFinish((cwd) => void import("./autoPr").then((m) => m.onAgentIdle(cwd)).catch(() => undefined));
