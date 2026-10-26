import type Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Group, Image as KonvaImage, Rect } from 'react-konva'
import { pdfAssetOf, type Page, type StudioDocument } from '@shared/document/model'
import { useAdjustments } from '../adjust/use-adjustments'
import { useAssetImage } from '../assets/asset-cache'
import { usePdfPage } from '../assets/pdf'

interface Props {
  doc: StudioDocument
  page: Page
}

/** Original page pixels (image or rendered PDF page) plus any patches painted over them. */
export function PageBackground({ doc, page }: Props) {
  const bg = page.background
  const image = useAssetImage(doc.id, bg.kind === 'image' ? bg.assetId : null)
  const pdfCanvas = usePdfPage(
    doc.id,
    bg.kind === 'pdf' ? pdfAssetOf(doc, bg) : null,
    bg.kind === 'pdf' ? bg.pageIndex : null
  )
  const source = bg.kind === 'image' ? image : pdfCanvas
  const ref = useRef<Konva.Group>(null)
  // Patches load asynchronously; each load must refresh the adjusted (cached) picture.
  const [loaded, setLoaded] = useState(0)
  // Page units are the picture's pixels, so the cache keeps full detail at ratio 1.
  useAdjustments(ref, page.adjustments, 1, [source, page.patches, page.width, page.height, loaded])

  return (
    <Group ref={ref} listening={false}>
      <Rect width={page.width} height={page.height} fill="#ffffff" />
      {source && <KonvaImage image={source} width={page.width} height={page.height} />}
      {page.patches.map((patch) => (
        <PatchImage key={patch.id} docId={doc.id} patch={patch} onLoad={() => setLoaded((n) => n + 1)} />
      ))}
    </Group>
  )
}

function PatchImage({
  docId,
  patch,
  onLoad
}: {
  docId: string
  patch: Page['patches'][number]
  onLoad(): void
}) {
  const image = useAssetImage(docId, patch.assetId)
  useEffect(() => {
    if (image) onLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report each loaded image once
  }, [image])
  return image ? (
    <KonvaImage image={image} x={patch.x} y={patch.y} width={patch.width} height={patch.height} />
  ) : null
}
