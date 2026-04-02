# api

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.18. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## Target language codes (accent / locale)

When an admin generates a language template, the **Target language code** should be a **BCP‑47 locale tag** like `es-ES`.

This code is used for:
- Course template generation (the AI is told which language you’re targeting)
- Browser text-to-speech (TTS) pronunciation + **accent/dialect** selection (depends on OS/browser voices installed)

### Common examples

- English: `en-US`, `en-GB`, `en-AU`, `en-IN`
- Spanish: `es-ES` (Spain), `es-MX` (Mexico), `es-AR` (Argentina), `es-US` (US)
- French: `fr-FR`, `fr-CA`, `fr-BE`, `fr-CH`
- Portuguese: `pt-BR` (Brazil), `pt-PT` (Portugal)
- German: `de-DE`, `de-AT`, `de-CH`
- Italian: `it-IT`, `it-CH`
- Dutch: `nl-NL`, `nl-BE`

- Japanese: `ja-JP`
- Korean: `ko-KR`
- Chinese: `zh-CN` (Simplified), `zh-TW` (Traditional), `zh-HK`
- Arabic: `ar-SA`, `ar-EG`, `ar-MA`
- Hindi: `hi-IN`
- Russian: `ru-RU`
- Turkish: `tr-TR`
- Polish: `pl-PL`
- Swedish: `sv-SE`
- Norwegian (Bokmål): `nb-NO`
- Danish: `da-DK`
- Finnish: `fi-FI`
- Greek: `el-GR`
- Hebrew: `he-IL`
- Thai: `th-TH`
- Vietnamese: `vi-VN`
- Indonesian: `id-ID`

Tip: if you care about the accent, prefer a **language + region** tag (like `es-ES`) instead of only a base language tag (like `es`).
