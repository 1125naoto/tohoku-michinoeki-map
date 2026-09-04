/**
 * 認証の抽象化。Phase1ではクラウド認証を一切要求せず、LocalOnlyAuthProviderが
 * 「常に未サインイン（ローカル利用者のみ）」を返す。将来Supabase Auth等へ
 * 差し替える際もこのインターフェースだけを実装すればよい。
 */

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthProvider {
  getCurrentUser(): AuthUser | null;
  signInWithGoogle(): Promise<AuthUser>;
  signInWithEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** 状態変化を購読する。戻り値は購読解除関数 */
  onAuthStateChanged(cb: (user: AuthUser | null) => void): () => void;
}

export class AuthNotAvailableError extends Error {
  constructor() {
    super('クラウド認証はこのビルドでは未設定です（Phase1: ローカル利用のみ）');
    this.name = 'AuthNotAvailableError';
  }
}

export class LocalOnlyAuthProvider implements AuthProvider {
  getCurrentUser(): AuthUser | null {
    return null;
  }
  async signInWithGoogle(): Promise<AuthUser> {
    throw new AuthNotAvailableError();
  }
  async signInWithEmail(): Promise<void> {
    throw new AuthNotAvailableError();
  }
  async signOut(): Promise<void> {
    /* ローカル利用者は常に未サインイン状態のためno-op */
  }
  onAuthStateChanged(cb: (user: AuthUser | null) => void): () => void {
    cb(null);
    return () => {};
  }
}
