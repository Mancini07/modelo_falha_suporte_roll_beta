/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço do Retina, quando diferente da produção. */
  readonly VITE_RETINA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
