// T-653: the one eager piece of the automatic pull request flow. When an agent finishes a turn it
// loads autoPr.ts on demand and hands the folder over, so the first-load bundle grows by bytes, not
// by the flow itself. The window imports this file once (App.tsx: `import "./scm/autoPrWatch";`).
import { onFinish } from "../status/finished";

onFinish((cwd) => void import("./autoPr").then((m) => m.onAgentIdle(cwd)).catch(() => undefined));
