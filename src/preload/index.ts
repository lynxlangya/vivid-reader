import { contextBridge, ipcRenderer } from 'electron';
import type { VividAPI } from '../shared/ipc';
const api: VividAPI = {
  ping: (request) => ipcRenderer.invoke('vivid:ping', request),
};
contextBridge.exposeInMainWorld('vivid', api);
