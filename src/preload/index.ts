import { contextBridge, ipcRenderer } from 'electron';
import type { VividAPI } from '../shared/ipc';
const api: VividAPI = {
  ping: (request) => ipcRenderer.invoke('vivid:ping', request),
  importBook: () => ipcRenderer.invoke('vivid:import', {}),
  restoreBook: () => ipcRenderer.invoke('vivid:restore', {}),
  savePosition: (cfi) => ipcRenderer.invoke('vivid:position', { cfi }),
  setApiKey: (value) => ipcRenderer.invoke('vivid:set-key', { value }),
  hasApiKey: () => ipcRenderer.invoke('vivid:has-key', {}),
  clearApiKey: () => ipcRenderer.invoke('vivid:clear-key', {}),
  pipelineStatus: () => ipcRenderer.invoke('vivid:pipeline-status', {}),
  preprocess: () => ipcRenderer.invoke('vivid:preprocess', {}),
  reviewEntities: () => ipcRenderer.invoke('vivid:review', {}),
  markReview: (entityId, correct) =>
    ipcRenderer.invoke('vivid:mark-review', { entityId, correct }),
};
contextBridge.exposeInMainWorld('vivid', api);
