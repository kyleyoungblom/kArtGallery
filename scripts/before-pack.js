// before-pack.js — electron-builder hook for cross-platform native modules
//
// Problem: Native modules (better-sqlite3, sharp) are compiled/installed for
// the HOST platform during development (macOS ARM64). When we build a Windows
// installer from macOS, those macOS binaries get bundled — and crash on Windows.
//
// Solution: This hook runs right before electron-builder assembles the app
// directory into the distributable. For non-host platforms, it:
//
// 1. better-sqlite3: Downloads the correct prebuilt .node binary from
//    the module's GitHub releases and swaps it into node_modules.
//
// 2. sharp: Installs the target platform's @img/sharp-<platform> npm
//    packages into node_modules so electron-builder bundles them.
//    sharp uses separate npm packages per platform (e.g., @img/sharp-win32-x64)
//    and npm only installs the host platform's optional deps by default.

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Electron 33 uses Node ABI v130 (Chromium 130).
// This must be updated if we bump the Electron major version.
const ELECTRON_MODULE_VERSION = '130'

// Read the actual installed version from package.json so we don't have to
// update this script every time we bump better-sqlite3.
const BETTER_SQLITE3_VERSION = require(
  path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'package.json')
).version

module.exports = async function beforePack(context) {
  // electron-builder passes a PackContext with .packager, .electronPlatformName, .arch, etc.
  // electronPlatformName is one of: 'darwin', 'win32', 'linux'
  // arch is a numeric enum: 1 = x64, 3 = arm64, 0 = ia32
  const platformName = context.electronPlatformName
  const arch = context.arch

  const archName =
    arch === 1 ? 'x64' :
    arch === 3 ? 'arm64' :
    arch === 0 ? 'ia32' :
    'x64'

  // If building for the host platform + arch, electron-rebuild already
  // compiled the correct binary during npm postinstall. Nothing to do.
  if (platformName === process.platform && archName === process.arch) {
    console.log(`[before-pack] Skipping ${platformName}-${archName} (host platform)`)
    return
  }

  console.log(`[before-pack] Cross-platform build detected: ${platformName}-${archName}`)
  console.log(`[before-pack] Fetching prebuilt better-sqlite3 v${BETTER_SQLITE3_VERSION} for electron ABI v${ELECTRON_MODULE_VERSION}`)

  // Download the prebuilt binary from better-sqlite3's GitHub releases.
  // The naming convention is: better-sqlite3-v{VERSION}-electron-v{ABI}-{platform}-{arch}.tar.gz
  const tag = `v${BETTER_SQLITE3_VERSION}`
  const asset = `better-sqlite3-${tag}-electron-v${ELECTRON_MODULE_VERSION}-${platformName}-${archName}.tar.gz`
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/${tag}/${asset}`

  const projectRoot = path.join(__dirname, '..')
  const tmpDir = path.join(projectRoot, '.prebuild-tmp')
  const tarPath = path.join(tmpDir, asset)
  const bindingDir = path.join(projectRoot, 'node_modules', 'better-sqlite3', 'build', 'Release')
  const binaryPath = path.join(bindingDir, 'better_sqlite3.node')
  const backupPath = path.join(bindingDir, 'better_sqlite3.node.host-backup')

  try {
    fs.mkdirSync(tmpDir, { recursive: true })

    // Back up the host-platform binary so we can restore it after packaging.
    // Without this, `npm run dev` would break after a cross-platform build
    // because the macOS .node file gets overwritten with the Windows one.
    if (fs.existsSync(binaryPath) && !fs.existsSync(backupPath)) {
      fs.copyFileSync(binaryPath, backupPath)
      console.log(`[before-pack] Backed up host binary`)
    }

    // Download the tarball
    console.log(`[before-pack] Downloading ${url}`)
    execSync(`curl -L --fail -o "${tarPath}" "${url}"`, { stdio: 'inherit' })

    // Extract — the tarball contains build/Release/better_sqlite3.node
    execSync(`tar xzf "${tarPath}" -C "${tmpDir}"`, { stdio: 'inherit' })

    // Swap the .node binary into the module's build directory
    const src = path.join(tmpDir, 'build', 'Release', 'better_sqlite3.node')
    if (!fs.existsSync(src)) {
      throw new Error(`Expected binary not found at ${src}`)
    }

    fs.mkdirSync(bindingDir, { recursive: true })
    fs.copyFileSync(src, binaryPath)

    console.log(`[before-pack] ✓ Installed better-sqlite3 for ${platformName}-${archName}`)
  } finally {
    // Clean up temp files regardless of success/failure
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  // ── sharp: install target-platform npm packages ──
  //
  // sharp uses optional npm dependencies per platform (@img/sharp-darwin-arm64,
  // @img/sharp-win32-x64, etc.). npm only installs the host platform's packages.
  // For cross-platform builds, we need to explicitly install the target's packages
  // into node_modules so electron-builder bundles them.
  //
  // We read sharp's optionalDependencies to get the exact versions, then install
  // only the packages matching the target platform+arch.

  const sharpPkg = require(
    path.join(projectRoot, 'node_modules', 'sharp', 'package.json')
  )
  const optDeps = sharpPkg.optionalDependencies || {}

  // Find all @img/* packages for the target platform-arch
  // e.g., for win32-x64: @img/sharp-win32-x64, @img/sharp-libvips-win32-x64
  const targetSuffix = `${platformName}-${archName}`
  const packagesToInstall = Object.entries(optDeps)
    .filter(([name]) => name.includes(targetSuffix))
    .map(([name, version]) => `${name}@${version}`)

  if (packagesToInstall.length === 0) {
    console.log(`[before-pack] No sharp packages found for ${targetSuffix}`)
    return
  }

  console.log(`[before-pack] Installing sharp packages for ${targetSuffix}: ${packagesToInstall.join(', ')}`)

  // Install into the project's node_modules. The --no-save flag prevents
  // modifying package.json. These packages will be picked up by electron-builder
  // when it copies node_modules into the app bundle.
  execSync(
    `npm install --no-save ${packagesToInstall.join(' ')}`,
    { cwd: projectRoot, stdio: 'inherit' }
  )

  console.log(`[before-pack] ✓ Installed sharp for ${platformName}-${archName}`)
}
