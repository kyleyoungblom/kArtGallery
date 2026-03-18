import { TabBar } from './components/layout/TabBar'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { LogPanel } from './components/layout/LogPanel'
import { SelectionPill } from './components/layout/SelectionPill'
import { GalleryGrid } from './components/gallery/GalleryGrid'
import { Lightbox } from './components/gallery/Lightbox'
import { InfoPanel } from './components/layout/InfoPanel'
import { SettingsModal } from './components/layout/SettingsModal'
import { DuplicateReviewModal } from './components/layout/DuplicateReviewModal'
import { useGalleryStore } from './stores/gallery.store'
import { useAccentColor } from './hooks/useAccentColor'
import { initThumbnailNotifications } from './hooks/useThumbnailReady'

// Initialize the single global IPC listener for thumbnail notifications.
// This runs once when the module loads — before any tiles mount.
initThumbnailNotifications()

export default function App(): JSX.Element {
  // Sync accent color from store → CSS custom properties on :root
  useAccentColor()
  const sidebarCollapsed = useGalleryStore((s) => s.sidebarCollapsed)
  const infoPanelOpen = useGalleryStore((s) => s.infoPanelOpen)
  const settingsOpen = useGalleryStore((s) => s.settingsOpen)
  const duplicateReviewOpen = useGalleryStore((s) => s.duplicateReviewOpen)

  const layoutClasses = [
    'app-layout',
    sidebarCollapsed ? 'app-layout--sidebar-collapsed' : '',
    infoPanelOpen ? 'app-layout--info-open' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={layoutClasses}>
      <Sidebar />
      <div className="app-main">
        <TabBar />
        <GalleryGrid />
        <SelectionPill />
        <LogPanel />
        <StatusBar />
      </div>
      <InfoPanel />
      <Lightbox />
      {settingsOpen && <SettingsModal />}
      {duplicateReviewOpen && <DuplicateReviewModal />}
    </div>
  )
}
