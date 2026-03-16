import { useState, useEffect } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import { useThumbnailReady } from '../../hooks/useThumbnailReady'
import type { FileEntry } from '../../types/models'

interface GalleryTileProps {
  data: FileEntry
  width: number
}

export function GalleryTile({ data, width }: GalleryTileProps): JSX.Element {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasCachedThumb, setHasCachedThumb] = useState(false)
  const cropToAspect = useGalleryStore((s) => s.cropToAspect)

  // Subscribe to the pub/sub system — this is a lightweight in-memory
  // subscription, NOT an IPC listener. One global IPC listener feeds all tiles.
  const thumbnailReady = useThumbnailReady(data.id, hasCachedThumb)

  // Request thumbnail. Runs on mount and again when thumbnailReady flips to true
  // (meaning the background worker just finished generating this file's thumbnail).
  useEffect(() => {
    let cancelled = false

    window.api.getThumbnail(data.id).then((thumbPath) => {
      if (cancelled || !thumbPath) return
      setImageSrc(`local-file://${thumbPath}`)
      setHasCachedThumb(thumbPath.endsWith(`${data.id}.jpg`))
      setLoaded(false)
    })

    return () => { cancelled = true }
  }, [data.id, thumbnailReady])

  const tileHeight = cropToAspect ? width : undefined

  return (
    <div className="gallery-tile" style={{ width }}>
      <div
        className="gallery-tile-image-container"
        style={tileHeight ? { height: tileHeight } : undefined}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={data.filename}
            className={`gallery-tile-image ${loaded ? 'gallery-tile-image--loaded' : ''}`}
            style={{ objectFit: cropToAspect ? 'cover' : 'contain' }}
            onLoad={() => setLoaded(true)}
            loading="lazy"
          />
        ) : (
          <div className="gallery-tile-placeholder gallery-tile-placeholder--loading" />
        )}
      </div>
      <div className="gallery-tile-label" title={data.filename}>
        {data.filename}
      </div>
    </div>
  )
}
