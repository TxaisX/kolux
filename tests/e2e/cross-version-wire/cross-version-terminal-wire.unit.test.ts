import { beforeAll, describe, expect, it } from 'vitest'
import { comparePublishedFieldOccurrences } from './published-field-shape'
import { resolveBaselineReleaseRef } from './release-checkout'
import {
  JOURNEY_INPUTS,
  JOURNEY_STEPS,
  runTerminalSkewJourney,
  type JourneyRecord
} from './terminal-skew-journey'
import {
  loadTerminalWireBuild,
  WORKING_TREE,
  type TerminalWireBuild
} from './versioned-terminal-wire'

const SUITE_TIMEOUT_MS = 180_000
const EXPECTED_FRAMES = [
  'C>H Subscribe',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Input',
  'H>C Output',
  'C>H SnapshotRequest',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Subscribe',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Input',
  'C>H Unsubscribe'
]

let baselineRef: string
let current: TerminalWireBuild
let baseline: TerminalWireBuild
let currentReference: JourneyRecord
let baselineReference: JourneyRecord

beforeAll(async () => {
  baselineRef = resolveBaselineReleaseRef()
  ;[current, baseline] = await Promise.all([
    loadTerminalWireBuild(WORKING_TREE),
    loadTerminalWireBuild(baselineRef)
  ])
  // Why: each journey's link owns the stubbed global `window`, so journeys cannot overlap.
  currentReference = await runTerminalSkewJourney({ hostBuild: current, clientBuild: current })
  baselineReference = await runTerminalSkewJourney({ hostBuild: baseline, clientBuild: baseline })
}, SUITE_TIMEOUT_MS)

function expectCompleteJourney(record: JourneyRecord): void {
  expect(record.completed).toEqual([...JOURNEY_STEPS])
  expect(record.frameSequence).toEqual(EXPECTED_FRAMES)
  expect(record.rejected).toEqual([])
  expect(record.clientErrors).toEqual([])
  expect(record.missingRuntimeMethods).toEqual([])
  expect(record.subscribedEvents).toHaveLength(2)
  expect(record.snapshotStarts).toHaveLength(3)
  expect(record.inputAtProcess).toEqual([JOURNEY_INPUTS.first, JOURNEY_INPUTS.second])
  expect(record.snapshotsRendered[0]).toBe(JOURNEY_INPUTS.initialBuffer)
  expect(record.dataRendered.join('')).toBe(JOURNEY_INPUTS.output)
  expect(record.revealSnapshot?.data).toBe(
    `${JOURNEY_INPUTS.initialBuffer}${JOURNEY_INPUTS.output}`
  )
}

// Extracting two source trees from a OneDrive-backed checkout stalls on Windows;
// the Linux CI lane runs the real pairings.
describe.skipIf(process.platform === 'win32')('Kolux cross-version remote terminal wire', () => {
  it('uses a real Kolux release as the baseline', () => {
    expect(baselineRef).toMatch(/^v0\./)
    expect(baseline.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(baseline.revision).not.toBe(current.revision)
  })

  it('completes both same-version control journeys', () => {
    expectCompleteJourney(currentReference)
    expectCompleteJourney(baselineReference)
  })

  it(
    'keeps an old client working with a current host',
    async () => {
      const record = await runTerminalSkewJourney({ hostBuild: current, clientBuild: baseline })
      expectCompleteJourney(record)
      expect(record.snapshotStarts).toEqual(currentReference.snapshotStarts)
    },
    SUITE_TIMEOUT_MS
  )

  it(
    'keeps a current client working with an old host',
    async () => {
      const record = await runTerminalSkewJourney({ hostBuild: baseline, clientBuild: current })
      expectCompleteJourney(record)
      expect(record.snapshotStarts).toEqual(baselineReference.snapshotStarts)
    },
    SUITE_TIMEOUT_MS
  )

  it('does not remove fields the released host published', () => {
    const differences = comparePublishedFieldOccurrences({
      older: baselineReference.snapshotStarts,
      newer: currentReference.snapshotStarts,
      olderLabel: baselineRef,
      newerLabel: 'working tree'
    })
    for (const difference of differences) {
      expect(difference.removed).toEqual([])
    }
  })
})
