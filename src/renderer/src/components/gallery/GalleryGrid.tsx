import { useRef } from 'react'
import { Masonry, RenderComponentProps } from 'masonic'
import { useGalleryStore } from '../../stores/gallery.store'
import { useGalleryFiles } from '../../hooks/useGalleryFiles'
import { GalleryTile } from './GalleryTile'
import type { FileEntry } from '../../types/models'

// Masonic handles virtualization automatically — it only renders tiles that
// are currently visible in the viewport (plus a small overscan buffer).
// This is what makes it possible to browse 10,000+ images without the
// browser grinding to a halt. Without virtualization, the DOM would have
// 10,000+ image elements, consuming gigabytes of memory.

function MasonryTile({ data, width }: RenderComponentProps<FileEntry>): JSX.Element {
  return <GalleryTile data={data} width={width} />
}

export function GalleryGrid(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { files, isLoading } = useGalleryFiles()
  const tileSize = useGalleryStore((s) => s.tileSize)
  const gapSize = useGalleryStore((s) => s.gapSize)
  const currentPath = useGalleryStore((s) => s.currentPath)

  if (!currentPath) {
    return (
      <div className="gallery-empty">
        <p>Select a folder to start browsing</p>
      </div>
    )
  }

  if (isLoading && files.length === 0) {
    return (
      <div className="gallery-empty">
        <p>Scanning folder...</p>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="gallery-empty">
        <p>No images found in this folder</p>
      </div>
    )
  }

  return (
    <div className="gallery-grid" ref={containerRef}>
      <Masonry<FileEntry>
        items={files}
        columnWidth={tileSize}
        columnGutter={gapSize}
        overscanBy={5}
        render={MasonryTile}
      />
    </div>
  )
}
