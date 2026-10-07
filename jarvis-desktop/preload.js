const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  store: {
    get: (key, def) => ipcRenderer.invoke('store:get', key, def),
    set: (key, val) => ipcRenderer.invoke('store:set', key, val),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
  },
  dev: {
    verify: (pin) => ipcRenderer.invoke('dev:verify', pin),
    setPin: (pin) => ipcRenderer.invoke('dev:setPin', pin),
  },
  api: {
    chat: (cfg) => ipcRenderer.invoke('api:chat', cfg),
    analyze: (cfg) => ipcRenderer.invoke('api:analyze', cfg),
    test: (cfg) => ipcRenderer.invoke('api:test', cfg),
    models: (cfg) => ipcRenderer.invoke('api:models', cfg),
  },
  files: {
    openPicker: () => ipcRenderer.invoke('dialog:openFiles'),
    readBase64: (p) => ipcRenderer.invoke('file:readBase64', p),
    readText: (p, max) => ipcRenderer.invoke('file:readText', p, max),
    exportZip: (args) => ipcRenderer.invoke('export:zip', args),
  },
  shell: { openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url) },
  overlay: {
    show: () => ipcRenderer.invoke('overlay:show'),
    hide: () => ipcRenderer.invoke('overlay:hide'),
    startWake: () => ipcRenderer.invoke('overlay:startWakeListening'),
    stopWake: () => ipcRenderer.invoke('overlay:stopWakeListening'),
  },
  tray: { setWakeState: (on) => ipcRenderer.invoke('tray:setWakeState', on) },
  main: { openAndFocus: () => ipcRenderer.invoke('main:openAndFocus') },
  on: (channel, cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args)),
});
