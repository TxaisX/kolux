// T-654 (DT-C89): `<LocalOnlyBadge dir={path} />`, the small "local only" icon for a workspace whose
// repository has no remote (it shows whether the automatic flow is on or off). It renders nothing
// until it knows. This is only the shell: the sidebar's first load is on a byte budget, so the
// question to the back end and the icon load on demand (LocalOnlyCheck.tsx).
import { lazy, Suspense } from "react";

const Check = lazy(() => import("./LocalOnlyCheck"));

export const LocalOnlyBadge = ({ dir }: { dir: string }) => (
  <Suspense fallback={null}>
    <Check dir={dir} />
  </Suspense>
);

export default LocalOnlyBadge;
