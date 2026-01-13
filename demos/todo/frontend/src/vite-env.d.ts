/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API URL (default: http://localhost:3101) */
  readonly VITE_API_URL: string;
  /** Chat server URL (default: http://localhost:3101) */
  readonly VITE_CHAT_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
