// after-pack.js — electron-builder hook to restore host-platform native binaries
//
// The before-pack hook swaps in a cross-platform binary (e.g., Windows .node
// file) before electron-builder assembles the app bundle. After packaging is
// done, we need to restore the original host-platform binary so that
// `npm run dev` still works on the developer's machine.
//
// Without this, running `npm run dist:win` on macOS would leave the Windows
// better-sqlite3 binary in node_modules, and the next `npm run dev` would
// crash with a "not a valid mach-o file" error.

const fs = require('fs')
const path = require('path')

module.exports = async function afterPack() {
  const projectRoot = path.join(__dirname, '..')
  const bindingDir = path.join(projectRoot, 'node_modules', 'better-sqlite3', 'build', 'Release')
  const binaryPath = path.join(bindingDir, 'better_sqlite3.node')
  const backupPath = path.join(bindingDir, 'better_sqlite3.node.host-backup')

  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, binaryPath)
    fs.unlinkSync(backupPath)
    console.log(`[after-pack] Restored host-platform better-sqlite3 binary`)
  }
}
