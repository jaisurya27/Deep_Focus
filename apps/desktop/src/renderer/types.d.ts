import type { DeepFocusAPI } from "../preload";

declare global {
  interface Window {
    deepFocus: DeepFocusAPI;
  }
}

export {};
