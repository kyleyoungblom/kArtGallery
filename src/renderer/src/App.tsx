import { Sidebar } from './components/layout/Sidebar'
import { Toolbar } from './components/layout/Toolbar'
import { GalleryGrid } from './components/gallery/GalleryGrid'

// The app layout is a classic sidebar + main content pattern.
// CSS Grid handles the layout — no absolute positioning or manual calculations.
// The sidebar has a fixed width, the main content fills the remaining space.

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
