import { useState, useEffect } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import type { FileEntry } from '../../types/models'

// Each tile lazily loads its thumbnail. The tile renders a placeholder first,
// then requests the thumbnail path via IPC. This ensures the grid can display
// thousands of tiles immediately — only visible tiles trigger image loads.

interface GalleryTileProps {
  data: FileEntry
  width: number
}

export function GalleryTile({ data, width }: GalleryTileProps): JSX.Element {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const cropToAspect = useGalleryStore((s) => s.cropToAspect)

  useEffect(() => {
    let cancelled = false

    window.api.getThumbnail(data.id).then((thumbPath) => {
      if (!cancelled && thumbPath) {
        // Use our custom protocol to load files securely
        setImageSrc(`local-file://${thumbPath}`)
      }
    })

    // Cleanup function: if the component unmounts before the thumbnail loads
    // (e.g., user scrolls past it), we cancel the state update to avoid
    // React's "can't update unmounted component" warning.
    return () => {
      cancelled = true
    }
  }, [data.id])

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
          <div className="gallery-tile-placeholder" />
        )}
      </div>
      <div className="gallery-tile-label" title={data.filename}>
        {data.filename}
      </div>
    </div>
  )
}
