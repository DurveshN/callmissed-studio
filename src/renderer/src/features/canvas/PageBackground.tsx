import { Image as KonvaImage, Rect } from 'react-konva'
import type { Page, StudioDocument } from '@shared/document/model'
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
    bg.kind === 'pdf' ? doc.source.assetId : null,
    bg.kind === 'pdf' ? bg.pageIndex : null
  )
  const source = bg.kind === 'image' ? image : pdfCanvas

  return (
    <>
      <Rect width={page.width} height={page.height} fill="#ffffff" listening={false} />
      {source && <KonvaImage image={source} width={page.width} height={page.height} listening={false} />}
      {page.patches.map((patch) => (
        <PatchImage key={patch.id} docId={doc.id} patch={patch} />
      ))}
    </>
  )
}

function PatchImage({ docId, patch }: { docId: string; patch: Page['patches'][number] }) {
  const image = useAssetImage(docId, patch.assetId)
  return image ? (
    <KonvaImage
      image={image}
      x={patch.x}
      y={patch.y}
      width={patch.width}
      height={patch.height}
      listening={false}
    />
  ) : null
}
