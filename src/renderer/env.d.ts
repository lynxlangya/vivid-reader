import type { VividAPI } from '../shared/ipc';
declare global {
  interface Window {
    vivid: VividAPI;
  }
}
