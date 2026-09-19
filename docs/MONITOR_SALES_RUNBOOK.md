# 先行モニター販売 運用手順（FIRST 10 PAID MONITORS / MANUAL FULFILMENT）

販売名称「道の駅ナビ 先行モニター」／先行モニター価格 月額250円／正式版 月額500円を予定。
販売方式は**手動対応**（Supabase・アカウント・自動entitlementは作らない。最初の10人で需要を確認してから判断する）。

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
- 事業者情報・Live URLは `src/monitorSite/config.ts` にだけ置く。**公開リポジトリなので、Ownerが確認した値だけを入れる。Stripeの秘密鍵は絶対に入れない**（Payment Link / Portal URLは公開URLで秘密ではない）。
- Service Workerは `/monitor/` をprecache・SPAフォールバックの対象外にしている（`vite.config.ts`）。

## 2. 現在の状態（受付準備中）

`config.ts` の `owner`（事業者情報）と `live`（Live URL）が空のため、本番の `/monitor/` は**受付準備中**（申込ボタンなし・noindex）。
`/monitor/status.json` の `salesOpen` と `missing` で現在の状態と不足項目を確認できる。
次がすべて揃うと自動的に**受付中**になる（`evaluateSalesGate`。Test modeのURLはLiveとして受け付けない）:

| 項目 | 内容 |
|---|---|
| `owner.sellerName` | 特商法の販売事業者名（個人の場合は氏名）**Owner確認** |
| `owner.addressDisclosure` / `address` | 所在地: `on_request`（請求があれば遅滞なく開示。要件あり）か `published`（掲載）**Owner確認** |
| `owner.phoneDisclosure` / `phone` | 電話番号: 同上 **Owner確認** |
| `owner.supportEmail` | 購入者サポート／改善要望の受付メール **Owner確認** |
| `owner.taxNote` | 税の表示（例: 表示価格は税込みです）**Owner確認** |
| `owner.refundPolicy` | 返金・キャンセル条件 **Owner決定** |
| `owner.effectiveDate` | 制定日 `YYYY-MM-DD` |
| `owner.responseTimeNote` | （任意）利用案内メールをお送りするまでの目安 |
| `live.paymentLink` | Stripe **Live** の Payment Link（`https://buy.stripe.com/…`。`test_` は不可） |
| `live.portalLoginUrl` | Stripe **Live** の Customer Portal ログインURL（`https://billing.stripe.com/p/login/…`） |

## 3. Stripe Live セットアップ（Owner本人が実行）

Test modeでは次を作成・検証済み（`config.ts` の `test`）。Liveは同じ内容をOwnerがLiveで作る。
Stripe CLIで行う場合は `stripe login`（ブラウザ承認）後、各コマンドに `--live` を付ける。**秘密鍵はチャットへ貼らない**。

```bash
# 1) Product
stripe products create --live --name "道の駅ナビ 先行モニター" \
  --description "道の駅ナビ 先行モニター（月額）。全国版の利用、先行モニターとしての参加、改善要望の送信。" \
  -d "metadata[app]=michinoeki-navi" -d "metadata[plan]=early-monitor"

# 2) Price（月額250円）  ※<PRODUCT_ID> は 1) の id
stripe prices create --live --product <PRODUCT_ID> --currency jpy --unit-amount 250 \
  -d "recurring[interval]=month" --lookup-key michinoeki_monitor_250_monthly

# 3) Payment Link（決済後は /monitor/thanks/ へ）  ※<PRICE_ID> は 2) の id
stripe payment_links create --live \
  -d "line_items[0][price]=<PRICE_ID>" -d "line_items[0][quantity]=1" \
  -d "after_completion[type]=redirect" \
  -d "after_completion[redirect][url]=https://1125naoto.github.io/tohoku-michinoeki-map/monitor/thanks/" \
  -d "billing_address_collection=auto" \
  -d "custom_text[submit][message]=お申込みにより、利用規約・プライバシーポリシー・特定商取引法に基づく表記（https://1125naoto.github.io/tohoku-michinoeki-map/monitor/）に同意したものとみなします。月額250円は毎月自動更新され、解約は決済後のページからいつでも手続きできます。" \
  -d "subscription_data[metadata][app]=michinoeki-navi" -d "metadata[app]=michinoeki-navi"

# 4) Customer Portal（解約は請求期間の終了時。専用ログインページを有効化）
stripe billing_portal configurations create --live \
  -d "name=道の駅ナビ 先行モニター（解約・支払い管理）" \
  -d "business_profile[headline]=道の駅ナビ 先行モニターのお支払い管理・解約" \
  -d "business_profile[privacy_policy_url]=https://1125naoto.github.io/tohoku-michinoeki-map/monitor/privacy/" \
  -d "business_profile[terms_of_service_url]=https://1125naoto.github.io/tohoku-michinoeki-map/monitor/terms/" \
  -d "default_return_url=https://1125naoto.github.io/tohoku-michinoeki-map/monitor/" \
  -d "features[invoice_history][enabled]=true" -d "features[payment_method_update][enabled]=true" \
  -d "features[customer_update][enabled]=true" -d "features[customer_update][allowed_updates][0]=email" \
  -d "features[subscription_cancel][enabled]=true" -d "features[subscription_cancel][mode]=at_period_end" \
  -d "features[subscription_cancel][proration_behavior]=none" \
  -d "features[subscription_update][enabled]=false" -d "login_page[enabled]=true"
```

4) の出力の `login_page.url` が `live.portalLoginUrl`、3) の `url` が `live.paymentLink`。
Stripeダッシュボードで同じ設定を行っても良い。

**必ず確認・決める点**

- **決済ページ／領収書に出る事業者名は Stripe アカウントの公開ビジネス名**（Test modeでは「お宝ファインダーサンドボックス」）。同じStripeアカウントを使うと、購入者には「お宝ファインダー」名義で表示される。道の駅ナビの購入者に混乱を与えないよう、(a) アカウントの公開ビジネス名を整理する、(b) 別アカウントにする、のどちらかをOwnerが決める。
- **新規の申込みを知る手段**: Stripeダッシュボード（設定 → メール通知）で「支払い成功」等の通知をONにする。手動対応のため、通知が唯一のトリガーになる。
- 既存のBusiness OS（お宝ファインダー）のWebhookは、同じStripeアカウントの道の駅ナビのイベントを受け取っても「該当顧客なし」として無視する（確認済み。誤処理なし）。

## 4. 受付を開く手順

1. `src/monitorSite/config.ts` の `owner` と `live` を、Ownerが確認した値で埋める（この作業はClaude Codeに依頼してよい。値はチャットに貼って良いが、**Stripeの秘密鍵は貼らない**）。
2. `npx vitest run src/monitorSite` → `npm run build` → `npx playwright test e2e/monitor-site.spec.ts` を通す（受付中になると「準備中」前提のe2eは更新が必要）。
3. `main` へpush（GitHub Pagesへ自動デプロイ）。
4. `https://1125naoto.github.io/tohoku-michinoeki-map/monitor/status.json` が `salesOpen: true` になったことを確認。
5. **Live Payment Linkを実際に開き、金額が¥250/月であることだけ確認する**（自分で購入するかはOwner判断）。
6. Business OSのCampaign（`a2272ba3cb6040329c7410cbc70ec34e`）のdestination/CTAが `/monitor/` と一致していることを確認してから、SNS用のAI仕上げ・投稿へ進む。

## 5. 新しい先行モニターが決済したら（手動対応）

1. Stripeの通知（またはダッシュボード）で決済とメールアドレスを確認。
2. 購入者のメールアドレス宛に、利用開始のご案内（アプリのURL・ホーム画面への追加方法・改善要望の送り先）を送る。
3. 改善要望は `owner.supportEmail` に届く。要望を実装する約束はしていない（LP・規約に明記済み）。
4. 解約はCustomer Portalで購入者自身が行う（請求期間の終了時に有効）。

## 6. QA（Test mode）で見た目と導線を確認する

```powershell
$env:DEPLOY_BASE='/tohoku-michinoeki-map/'; $env:MONITOR_MODE='test'
npx vite build --outDir dist-test
npx vite preview --outDir dist-test --port 4181 --strictPort   # http://localhost:4181/tohoku-michinoeki-map/monitor/
```

- `MONITOR_MODE=test` のビルドは「TEST BUILD」表示・noindex・Stripe Test URL・ダミー事業者情報で**受付中**の見た目を出す。**このビルドは公開しない**。
- Git Bash では `DEPLOY_BASE=/…` がWindowsパスに書き換えられる（MSYSのパス変換）。**PowerShellから実行する**こと。

Test modeのStripe ID（実課金なし）: product `prod_VHnEmi8owLfA7e` / price `price_1UHDe0EtgcvJ6JiZ0hg8uRsq` / payment link `plink_1UHDeEEtgcvJ6JiZDk1SLopC` / portal config `bpc_1UHDeSEtgcvJ6JiZOBvG8giu`。

## 7. アプリ本体の公開状態について（重要）

アプリ本体（`https://1125naoto.github.io/tohoku-michinoeki-map/`）は**現在、誰でもログインなしで使える公開状態**で、GitHub Pagesでは**本当の認証・アクセス制御は作れない**（リポジトリ自体も公開）。
販売サイトは、そのことを隠さず「先行モニターは参加型プログラム（参加・フィードバック・意見反映の機会）で、モニター専用の機能制限は設けていない」と明記している。
将来「有料でないと使えない」状態にしたい場合は、アカウント・サーバー側の購読状態確認（`PRODUCT_ARCHITECTURE.md` §5・§7）が必要で、最初の10人で需要を確認してから判断する。
