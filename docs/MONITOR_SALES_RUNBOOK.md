# 先行モニター販売 運用手順（FIRST 10 PAID MONITORS / MANUAL FULFILMENT）

販売名称「道の駅ナビ 先行モニター」／先行モニター価格 月額250円（税込）／正式版 月額500円を予定。
販売方式は**手動対応**（Supabase・アカウント・自動entitlementは作らない。最初の10人で需要を確認してから判断する）。
**Ownerがコマンド実行・ファイル編集をする必要はない。** Claude Codeが実行し、Owner本人にしかできない操作だけを最後に示す。

## 1. 構成

```
SNS / Business OS ─▶ 販売LP  /monitor/  ─▶ Stripe Payment Link（決済）
                                              │ 決済完了
                                              ▼
                                    ご案内ページ /monitor/thanks/
                                              │（運営者が入金確認→メールで利用案内）
                                              ▼
                                    道の駅ナビ本体（既存の公開URL）
                                              │ 改善要望はメール（/monitor/contact/）
                                              ▼
                       解約は Stripe Customer Portal（ログインページ）
```

- ページは `src/monitorSite/render.ts` が静的HTMLとして生成し、`vite build` が `dist/monitor/` へ出力する（JS・Cookie・解析なし）。
- 事業者情報・Live URLは `src/monitorSite/config.ts` にだけ置く。**公開リポジトリなので、Ownerが既に公開している事実だけを入れ、Stripeの秘密鍵は絶対に入れない**（Payment Link / Portal URLは公開URLで秘密ではない）。
- Service Workerは `/monitor/` をprecache・SPAフォールバックの対象外にしている（`vite.config.ts`）。

## 2. 現在の状態と、受付が開く条件

`/monitor/status.json` で確認できる: `ownerInfoReady`（事業者情報が確認済みか）と `salesOpen`（購入ボタンまで開いているか）と `missing`。

| 項目 | 状態 | 出所 |
|---|---|---|
| 販売事業者名（個人事業主）・所在地/電話の請求開示方式・お問い合わせメール | 反映済み | お宝ファインダーで既に公開している特商法表記（Business OSの `LEGAL_*` 設定）と同一の事実。**メールはStripe登録・購入者サポート用の窓口として再利用** |
| 価格表示: 月額250円（税込）／正式版は月額500円を予定 | 反映済み | Owner指定 |
| 返金: 決済済み期間は原則返金なし（法令上必要な場合・重複請求・運営者側の決済事故などは除外しない） | 反映済み（**Owner review required**） | Owner指定の暫定方針 |
| 解約: いつでも解約可能。解約後は次回以降の請求を停止（現在の請求期間の終了時に有効） | 反映済み | Owner指定＋Customer Portalの設定と一致 |
| 制定日 | 2026年9月19日 | Owner指定 |
| `live.paymentLink` / `live.portalLoginUrl` | **未設定 → 「受付準備中」（購入ボタンなし・noindex）** | Stripe Liveで作成後に設定 |

お宝ファインダー固有の条件（14日間の返金保証・アカウント/ログイン・LINE通知・Cookie等）は**持ち込んでいない**。

## 3. Stripe Live 設定（Claude Codeが自動実行。Owner本人の操作は下記だけ）

自動化スクリプト: `node scripts/stripe-monitor-setup.mjs`（冪等。既存オブジェクトを検出して再利用し、重複しない。Test modeで冪等性を検証済み）。
Liveで作成するには `--live --apply --confirm-live-create` が必須（片方だけなら拒否）。**Ownerの承認前にLiveオブジェクトは作らない。**

作成されるもの（Liveでも同じ内容）:

| 種別 | 内容 |
|---|---|
| Product | 道の駅ナビ 先行モニター（カード明細表記 `MICHINOEKI NAVI`） |
| Price | JPY 250 / month（lookup key `michinoeki_monitor_250_monthly`） |
| Payment Link | 決済後は `/monitor/thanks/` へ。利用規約・特商法への同意文言つき |
| Customer Portal | 解約は請求期間の終了時。専用ログインページ。請求履歴・支払い方法・メール変更。プラン変更は不可 |

### Owner本人にしかできない操作（最小）

1. **承認の返信**: 「Live作成を承認します」と伝える。
2. **Stripeの承認ボタンを1回押す**: Claude Codeが `stripe login --non-interactive` で「ブラウザURLと確認コード」を表示する。そのURLを開き、確認コードが一致することを見て、**Liveの（Sandboxではない）アカウント**で「承認（Allow）」を押す。CLIの操作は不要。認証情報はこのPCのStripe CLIに保存され、表示もチャット貼り付けも不要。Liveは別プロファイル（`STRIPE_PROJECT`）に保存し、既存のSandbox認証は変更しない。
3. **Stripeの公開ビジネス名を設定する**（Dashboard → 設定 → ビジネス → 公開情報）。下記の判定のとおり、これはDashboardでしか変更できない（APIキーでは変更不可）。
4. **メール通知をONにする**（Dashboard → 設定 → メール通知）。手動対応のため「支払い成功」の通知が申込みを知る唯一のトリガーになる。

Claude Codeが承認後に行うこと: Live作成 → 出力されたURLを `config.ts` の `live` へ反映 → 単体テスト・build・e2e → `main` へpush（自動デプロイ）→ `/monitor/status.json` が `salesOpen: true` になったことと、Payment Linkの金額（¥250/月）の表示を確認。

（フォールバック: 上記2をせず、DashboardでProduct/Price/Payment Link/Customer Portalを上の内容どおりに手で作り、Payment LinkのURLとPortalログインURL（どちらも公開URL）をClaude Codeへ伝えても同じ結果になる。）

## 4. Stripeの表示名（ブランディング）の判定

判明した事実:

- Stripe checkout・領収書・Customer Portalの事業者名は**アカウント単位**（公開ビジネス名）で、Payment Linkや商品の設定では上書きできない。Test modeのSandboxでは「お宝ファインダーサンドボックス」と表示される（実測）。
- Business OS（お宝ファインダー）のStripeは `STRIPE_MODE=test` で、**Liveで課金された実績・実顧客は無い**（Live化は未実施）。したがって公開ビジネス名を変更しても影響を受ける既存の購入者・領収書は、Business OS側には存在しない（Liveダッシュボード上の有無だけはOwnerが確認）。
- 変更が影響するのは**今後発行される**書類（領収書・メール・checkout・Portal）だけ。既存のProduct名・Price・過去の書類は変わらない。カード明細表記は、道の駅ナビの商品側に `MICHINOEKI NAVI` を指定して区別する。
- 販売事業者は同一の個人事業主なので、特商法の販売事業者名と決済ページの事業者名が一致するほうが購入者の信頼と法的整合性の面で望ましい。

| 案 | 判定 |
|---|---|
| **A. 既存アカウントを共通の事業者ブランドとして使う**（公開ビジネス名を特商法の販売事業者名に合わせる） | **最小・安全（推奨）**。Otakaraは未Liveのため影響なし。作業はDashboardの1項目。 |
| B. 道の駅ナビ用に別Stripeアカウント | 新規の本人確認・銀行口座・新しい認証が必要で重い。今回の目的（10人の需要確認）に対し過剰。 |
| C. 既存アカウントのまま商品側のブランディングで区別 | **不可**（checkoutの事業者名はアカウント単位で、商品側では変えられない）。 |

推奨Aの設定値: 公開ビジネス名 = 特商法の販売事業者名（個人事業主名）。屋号を使う場合も、特商法・LP・規約の事業者名と同じにすること。なお、Stripeの「特定商取引法に基づく表記のURL」欄はアカウント共通のため、複数商品を扱う間は空のままで構わない。

## 5. 新しい先行モニターが決済したら（手動対応）

1. Stripeの通知（またはダッシュボード）で決済とメールアドレスを確認。
2. 購入者のメールアドレス宛に、利用開始のご案内（アプリのURL・ホーム画面への追加方法・改善要望の送り先）を送る。
3. 改善要望は問い合わせメールに届く。要望を実装する約束はしていない（LP・規約に明記済み）。
4. 解約はCustomer Portalで購入者自身が行う（請求期間の終了時に有効）。

## 6. QA（Test mode）で見た目と導線を確認する（Claude Code用）

```powershell
$env:DEPLOY_BASE='/tohoku-michinoeki-map/'; $env:MONITOR_MODE='test'
npx vite build --outDir dist-test
npx vite preview --outDir dist-test --port 4181 --strictPort   # http://localhost:4181/tohoku-michinoeki-map/monitor/
```

- `MONITOR_MODE=test` のビルドは「TEST BUILD」表示・noindex・Stripe Test URL・ダミー事業者情報で**受付中**の見た目を出す。**このビルドは公開しない**。
- Git Bash では `DEPLOY_BASE=/…` や `stripe get /v1/…` の `/…` がWindowsパスに書き換えられる（MSYSのパス変換）。**PowerShellから実行する**か `MSYS_NO_PATHCONV=1` を付ける。

Test modeのStripe ID（実課金なし）: product `prod_VHnEmi8owLfA7e` / price `price_1UHDe0EtgcvJ6JiZ0hg8uRsq` / payment link `plink_1UHDeEEtgcvJ6JiZDk1SLopC` / portal config `bpc_1UHDeSEtgcvJ6JiZOBvG8giu`。

## 7. アプリ本体の公開状態について（重要）

アプリ本体（`https://1125naoto.github.io/tohoku-michinoeki-map/`）は**現在、誰でもログインなしで使える公開状態**で、GitHub Pagesでは**本当の認証・アクセス制御は作れない**（リポジトリ自体も公開）。
販売サイトは、そのことを隠さず「先行モニターは参加型プログラム（参加・フィードバック・意見反映の機会）で、モニター専用の機能制限は設けていない」と明記している。
将来「有料でないと使えない」状態にしたい場合は、アカウント・サーバー側の購読状態確認（`PRODUCT_ARCHITECTURE.md` §5・§7）が必要で、最初の10人で需要を確認してから判断する。

## 8. 商品情報の事実確認（Business OS Product Intelligence との整合）

アプリ（Production）で確認済みの事実: 全国1,237施設・47都道府県／訪問状態「未訪問・訪問済み・行きたい・スタンプ取得済み」／行きたい駅を選んでルート作成／ルートの所要時間（目安）／Googleマップへ引き継ぎ／周辺検索のカテゴリは「食べる・観光・温泉・休憩・宿泊」。**「買い物」カテゴリは存在しない**（配信JS全体に「買い物」の文字列なし）。
Business OSのProduct Intelligenceにあった「買い物」の記載（6箇所）は「温泉・休憩」へ訂正済み（2026-09-19、Owner経路・LLM呼び出しなし）。
