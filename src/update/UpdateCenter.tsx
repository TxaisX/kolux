// The update center's door. The screen itself (the notice, the card, the ready pop-up, the quiet timetable)
// is UpdateCenterView.tsx and loads on demand; only the small names the rest of the app calls it by are
// here, so the status bar, Help, the palette and recovery do not drag the screen into the first load.
import { Suspense, lazy } from "react";

export { requestUpdateCheck, BAR_EVENT, SHOW_EVENT, currentBar } from "./bus";

const View = lazy(() => import("./UpdateCenterView"));

export default function UpdateCenter() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}
