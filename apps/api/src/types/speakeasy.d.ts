declare module 'speakeasy' {
  interface GenerateSecretOptions {
    length?: number;
    name?: string;
    issuer?: string;
    symbols?: boolean;
    otpauth_url?: boolean;
    qr_codes?: boolean;
    google_auth_qr?: boolean;
  }

  interface GeneratedSecret {
    ascii: string;
    hex: string;
    base32: string;
    qr_code_ascii?: string;
    qr_code_hex?: string;
    qr_code_base32?: string;
    google_auth_qr?: string;
    otpauth_url?: string;
  }

  interface TotpVerifyOptions {
    secret: string;
    encoding?: 'ascii' | 'hex' | 'base32';
    token: string;
    window?: number;
    time?: number;
    step?: number;
    counter?: number;
  }

  interface TotpGenerateOptions {
    secret: string;
    encoding?: 'ascii' | 'hex' | 'base32';
    step?: number;
    time?: number;
    counter?: number;
    digits?: number;
    algorithm?: string;
  }

  interface Totp {
    generate(options: TotpGenerateOptions): string;
    verify(options: TotpVerifyOptions): boolean;
  }

  const totp: Totp;

  function generateSecret(options?: GenerateSecretOptions): GeneratedSecret;
  function otpauthURL(options: { secret: string; label: string; issuer?: string; encoding?: string; type?: string }): string;
}
