/**
 * クラウド同期の抽象化。Phase1はLocalOnlyCloudSyncProviderのみ（常にno-op/未接続）。
 * 将来Supabase等を接続する際も、既存のUserStateSnapshot型を介した
 * push/pullだけを実装すればよい（呼び出し側のコードは変更不要）。
 */
import type { UserStateSnapshot } from '../user/userModels';

export interface CloudSyncProvider {
  isAvailable(): boolean;
  pushUserState(userId: string, snapshot: UserStateSnapshot): Promise<void>;
  pullUserState(userId: string): Promise<UserStateSnapshot | null>;
}

export class LocalOnlyCloudSyncProvider implements CloudSyncProvider {
  isAvailable(): boolean {
    return false;
  }
  async pushUserState(): Promise<void> {
    /* Phase1: クラウド未接続のためno-op */
  }
  async pullUserState(): Promise<null> {
    return null;
  }
}
