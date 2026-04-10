/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
  readonly VITE_BASE_PATH?: string
}

// CSS Modules
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

// Plain CSS side-effect imports
declare module '*.css';

// swagger-ui-react (types not bundled in all versions)
declare module 'swagger-ui-react' {
  import { ComponentType } from 'react';
  interface SwaggerUIProps {
    url?: string;
    spec?: object;
    docExpansion?: 'list' | 'full' | 'none';
    defaultModelsExpandDepth?: number;
    [key: string]: unknown;
  }
  const SwaggerUI: ComponentType<SwaggerUIProps>;
  export default SwaggerUI;
}
