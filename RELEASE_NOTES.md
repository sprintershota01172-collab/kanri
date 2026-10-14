# kanri 1.1.0 リリースノート

## 実装

- 四象限TODO、エリア長押しドラッグ、グループモード、名前変更、ピン順位
- 月・週・ガント、パズル30分グリッド、日別のスナップ予定配置と取り消し
- SQLiteオフライン保存、OS通知カテゴリの完了・10分後スヌーズ（Nativeのみ）
- 期限前通知の分指定0〜10080、ライト/ダーク、ページ切替とモーダル編集
- アイコン3案と推奨A Folded K

## 検証結果（2026-10-14）

- Nativeモデルテスト: 9ケースPASS
- Native TSX/TSコード: TypeScript transpile構文検査PASS
- Web JS: node --check PASS
- Native依存関係の完全インストール/実機ビルド/パフォーマンス実測: 未検証
- Native共有要素トランジション: 未搭載。編集モーダルのスプリング登場で代替。
- Web版はPWA・ローカルストレージプレビューであり、OS通知アクションはない。

## 実行

Web: `cd web && python3 -m http.server 8000`
Native: `cd native && npm install && npx expo install --fix && npm test && npx expo run:ios`（Mac/Xcode必要）

※ネイティブ版はIPA/APKではなくソース。実機動作保証・App Store提出物ではない。
