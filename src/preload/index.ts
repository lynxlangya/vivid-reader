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
  relocate: (cfi, mode) => ipcRenderer.invoke('vivid:relocate', { cfi, mode }),
  readerState: () => ipcRenderer.invoke('vivid:reader-state', {}),
  setBoundary: (cfi) => ipcRenderer.invoke('vivid:boundary', { cfi }),
  card: (id) => ipcRenderer.invoke('vivid:card', { id }),
  gloss: (id, retry = false) =>
    ipcRenderer.invoke('vivid:gloss', { id, retry }),
  markKnown: (id) => ipcRenderer.invoke('vivid:known', { id }),
  correct: (id, action, qid) =>
    ipcRenderer.invoke('vivid:correct', {
      id,
      action,
      ...(qid ? { qid } : {}),
    }),
  searchCandidates: (id, query) =>
    ipcRenderer.invoke('vivid:candidates', { id, query }),
  onReaderState: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof listener>[0],
    ) => listener(state);
    ipcRenderer.on('vivid:state', receive);
    return () => {
      ipcRenderer.removeListener('vivid:state', receive);
    };
  },
  pipelineStatus: () => ipcRenderer.invoke('vivid:pipeline-status', {}),
  preprocess: () => ipcRenderer.invoke('vivid:preprocess', {}),
  reviewEntities: () => ipcRenderer.invoke('vivid:review', {}),
  markReview: (entityId, correct) =>
    ipcRenderer.invoke('vivid:mark-review', { entityId, correct }),
};
contextBridge.exposeInMainWorld('vivid', api);
