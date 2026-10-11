import { useEffect, useState } from 'react'
import { call } from '../../lib/ipc'

/**
 * Decoded image assets for the open document, keyed by asset id.
 * Bytes live in the main-process workspace; this cache only holds browser-side images.
 */
const images = new Map<string, Promise<HTMLImageElement>>()
const urls = new Map<string, string>()

function decode(blob: Blob, assetId: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  urls.set(assetId, url)
  const img = new Image()
  img.src = url
  return img.decode().then(() => img)
}

export function loadAssetImage(docId: string, assetId: string): Promise<HTMLImageElement> {
  let pending = images.get(assetId)
  if (!pending) {
    pending = call('asset:read', { docId, assetId }).then((bytes) =>
      decode(new Blob([bytes as Uint8Array<ArrayBuffer>]), assetId)
    )
    pending.catch(() => images.delete(assetId))
    images.set(assetId, pending)
  }
  return pending
}

/** Registers bytes the renderer already has (avoids a round-trip right after writing them). */
export function primeAssetImage(assetId: string, bytes: Uint8Array): Promise<HTMLImageElement> {
  const pending = decode(new Blob([bytes as Uint8Array<ArrayBuffer>]), assetId)
  images.set(assetId, pending)
  return pending
}

export function clearAssetCache(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
  images.clear()
}

export function useAssetImage(docId: string | null, assetId: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!docId || !assetId) return
    let alive = true
    loadAssetImage(docId, assetId)
      .then((img) => alive && setImage(img))
      .catch((error: unknown) => console.error('Failed to load asset', assetId, error))
    return () => {
      alive = false
    }
  }, [docId, assetId])
  return assetId ? image : null
}
