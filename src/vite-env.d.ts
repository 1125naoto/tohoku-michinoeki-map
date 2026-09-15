/// <reference types="vite/client" />

/** ビルド時に vite.config.ts の define で埋め込まれるビルド識別情報 */
declare const __BUILD_ID__: string;
declare const __BUILD_INFO__: {
  branch: string;
  commit: string;
  dirty: boolean;
  buildTime: string;
  environment: string;
  poiDataVersion: string;
  poiDataFiles: number;
};
