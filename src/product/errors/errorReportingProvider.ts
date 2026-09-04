/**
 * エラー監視の抽象化。実サービス（Sentry等）未接続のPhase1では、
 * 開発ビルド時のみconsoleへ出す実装をデフォルトにする。
 */

export type ErrorLevel = 'info' | 'warning' | 'error';

export interface ErrorReportingProvider {
  captureException(err: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, level?: ErrorLevel): void;
}

/** Phase1のデフォルト実装。本番ビルドでは何もしない（外部送信なし） */
export class ConsoleErrorReportingProvider implements ErrorReportingProvider {
  captureException(err: unknown, context?: Record<string, unknown>): void {
    if (import.meta.env.DEV) console.error(err, context);
  }
  captureMessage(message: string, level: ErrorLevel = 'info'): void {
    if (!import.meta.env.DEV) return;
    if (level === 'error') console.error(message);
    else if (level === 'warning') console.warn(message);
    else console.log(message);
  }
}
