import { Sidebar } from './components/layout/Sidebar'
import { Toolbar } from './components/layout/Toolbar'
import { GalleryGrid } from './components/gallery/GalleryGrid'
import { initThumbnailNotifications } from './hooks/useThumbnailReady'

// Initialize the single global IPC listener for thumbnail notifications.
// This runs once when the module loads — before any tiles mount.
initThumbnailNotifications()

export default function App(): JSX.Element {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <Toolbar />
        <GalleryGrid />
      </div>
    </div>
  )
}
