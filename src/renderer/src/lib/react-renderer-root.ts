import { createRoot, type Root } from 'react-dom/client'

type RendererRootHotData = {
  koluxRendererRoot?: Root
}

export function getOrCreateRendererRoot(
  container: HTMLElement,
  hotData?: RendererRootHotData
): Root {
  const existingRoot = hotData?.koluxRendererRoot
  if (existingRoot) {
    return existingRoot
  }
  const root = createRoot(container)
  if (hotData) {
    hotData.koluxRendererRoot = root
  }
  return root
}
