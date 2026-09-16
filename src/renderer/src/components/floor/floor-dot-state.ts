import type { AgentDotState } from '@/components/AgentStateDot'
import type { FloorSegmentKind } from './floor-types'

/** Map a Floor bar/state color onto the shared AgentStateDot glyph vocabulary
 *  used by the sidebar and dashboard — 'needs' renders the question glyph. */
export function floorDotState(kind: FloorSegmentKind): AgentDotState {
  return kind === 'needs' ? 'permission' : kind
}
