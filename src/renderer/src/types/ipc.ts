// IPC channel names as constants. Using constants instead of raw strings
// prevents typo bugs — if you misspell a constant name, TypeScript catches
// it at compile time. If you misspell a string, you get a silent runtime failure.

export const IPC = {
  // Request-response channels (invoke/handle)
  SCAN_FOLDER: 'gallery:scan-folder',
  GET_FOLDER_TREE: 'gallery:get-folder-tree',
  GET_THUMBNAIL: 'gallery:get-thumbnail',
  GET_FILES: 'gallery:get-files',
  SET_HIDDEN: 'gallery:set-hidden',
  CREATE_STACK: 'gallery:create-stack',
  UPDATE_STACK: 'gallery:update-stack',
  DISSOLVE_STACK: 'gallery:dissolve-stack',
  GET_PREFERENCES: 'preferences:get-all',
  SET_PREFERENCE: 'preferences:set',
  PICK_FOLDER: 'dialog:pick-folder',

  // Event channels (main -> renderer)
  SCAN_PROGRESS: 'scan:progress',
  THUMBNAIL_PROGRESS: 'thumbnails:progress',
  FILES_CHANGED: 'watcher:files-changed'
} as const
