import { useState, useEffect } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
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

  // Initial thumbnail request
  useEffect(() => {
    let cancelled = false

    window.api.getThumbnail(data.id).then((thumbPath) => {
      if (cancelled || !thumbPath) return
      setImageSrc(`local-file://${thumbPath}`)
      // Heuristic: if the path contains the file's ID followed by .jpg,
      // it's a cached thumbnail. Otherwise it's the original file fallback.
      setHasCachedThumb(thumbPath.endsWith(`${data.id}.jpg`))
    })

    return () => { cancelled = true }
  }, [data.id])

  // Listen for thumbnail-ready notifications. When this tile's thumbnail
  // finishes generating, re-request it to swap from fallback to cached version.
  // This is why thumbnails "pop in" progressively after a scan.
  useEffect(() => {
    // If we already have the cached thumbnail, no need to listen
    if (hasCachedThumb) return

    const unsubscribe = window.api.onThumbnailsReady((readyIds) => {
      if (readyIds.includes(data.id)) {
        window.api.getThumbnail(data.id).then((thumbPath) => {
          if (thumbPath) {
            setImageSrc(`local-file://${thumbPath}`)
            setHasCachedThumb(true)
            setLoaded(false) // Reset so fade-in plays again
          }
        })
      }
    })

    return unsubscribe
  }, [data.id, hasCachedThumb])

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
