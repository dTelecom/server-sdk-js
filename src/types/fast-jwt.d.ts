declare module 'fast-jwt' {
  export interface SignerOptions {
    algorithm?: string;
    key: string;
    iss?: string;
    [key: string]: any;
  }

  export interface VerifierOptions {
    algorithms?: string[];
    key: string;
    allowedIss?: string;
    [key: string]: any;
  }

  export function createSigner(options: SignerOptions): (payload: any) => string;
  export function createVerifier(options: VerifierOptions): (token: string) => any;
} 