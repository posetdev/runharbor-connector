/**
 * Provisional port: R2 (domain/ports/dynamodb) had not merged into this branch
 * when this file was written. Signatures follow 05-code-structure.md §1.1;
 * reconcile with R2's ports/secrets.ts on merge.
 */

export interface AppCredentialsData {
  readonly appId: string;
  readonly slug: string;
  readonly pem: string;
  readonly clientId: string;
  readonly webhookSecret: string;
}

/**
 * Wraps the GitHub App credential material read from SSM. toJSON() returns a
 * fixed placeholder so an accidental JSON.stringify(credentials) by a
 * usecase or logger never leaks the PEM or webhook secret (05 §4).
 */
export class AppCredentials {
  readonly appId: string;
  readonly slug: string;
  readonly pem: string;
  readonly clientId: string;
  readonly webhookSecret: string;

  constructor(data: AppCredentialsData) {
    this.appId = data.appId;
    this.slug = data.slug;
    this.pem = data.pem;
    this.clientId = data.clientId;
    this.webhookSecret = data.webhookSecret;
  }

  toJSON(): string {
    return '[redacted]';
  }
}

export interface SecretsPort {
  readAppCredentials(parameterName: string): Promise<AppCredentials>;
  writeAppCredentials(parameterName: string, data: AppCredentialsData): Promise<void>;
}
