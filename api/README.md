# api

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

To run (production):

```bash
bun run start
```

This project was created using `bun init` in bun v1.2.18. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## Configuration

### Environment variables

See `.env.example` for a starting point.

- `DATABASE_URL` (required)
- `JWT_SECRET` (required; in `NODE_ENV=production` must be >= 32 chars)
- `CORS_ORIGIN` (default: `http://localhost:3000`)
- `PORT` (default: `3001`)
- `NODE_ENV` (`development` | `production`)
- `GOOGLE_CLIENT_ID` (required for `POST /auth/google`)

OpenRouter (used by book AI endpoints, unseen generation, and admin language template generation):

- `OPENROUTER_API_KEY` (required to use OpenRouter-backed endpoints)
- `OPENROUTER_MODELS` (optional, comma-separated) — explicit ordered list of models to try
- `OPENROUTER_MODEL` (optional) — preferred model; if set, the API will still fall back to built-in free models to reduce hard failures
- `OPENROUTER_APP_NAME`, `OPENROUTER_APP_URL` (optional; sent as OpenRouter headers)
- `OPENROUTER_BASE_URL` (optional; defaults to OpenRouter Chat Completions URL)
- `OPENROUTER_TIMEOUT_MS` (optional)

Note: some free models can be temporarily rate-limited upstream. If you see `429` errors, retry later and/or configure multiple models via `OPENROUTER_MODELS`.

## Auth model

- Access token: returned in JSON as `accessToken`. Send it on protected routes as `Authorization: Bearer <token>`.
- Refresh token: stored as an httpOnly `refreshToken` cookie, rotated by `POST /auth/refresh`.
- CORS: the API enables `credentials: true` and expects the client to send cookies (`withCredentials: true`).

## Endpoints

### Health

- `GET /health` — health check

### Auth

- `POST /auth/register` — create user; sets refresh cookie
- `POST /auth/login` — login with email/password; sets refresh cookie
- `POST /auth/google` — login with Google ID token; sets refresh cookie
- `POST /auth/refresh` — rotate refresh token cookie; returns new access token
- `POST /auth/logout` — revoke refresh tokens and clear cookie

### Passages (auth required)

- `GET /passages` — list default passages + your custom passages
- `POST /passages` — create a custom passage
- `DELETE /passages/:id` — delete one of your custom passages

### Sessions (auth required)

- `POST /sessions` — store a reading session
- `GET /sessions` — list your sessions (supports `page` + `limit` query params)
- `GET /sessions/stats` — aggregate stats + WPM-over-time

### Unseen (auth required)

- `GET /unseen` — list published unseen passages (+ your own)
- `POST /unseen/generate` — generate an unseen passage via OpenRouter
- `GET /unseen/attempts` — list your unseen attempts
- `POST /unseen/:id/start` — start an unseen attempt
- `GET /unseen/attempts/:attemptId` — attempt detail
- `GET /unseen/attempts/:attemptId/questions` — questions (gated by timer/submission)
- `POST /unseen/attempts/:attemptId/submit` — submit answers
- `GET /unseen/attempts/:attemptId/result` — graded result

### Language (auth required)

- `GET /language` — published templates + your courses
- `GET /language/courses/:courseId` — course detail + lessons
- `POST /language/enroll` — enroll in a published template (clones to user tables)
- `POST /language/lessons/:lessonId/start` — start lesson attempt (creates exercises if needed)
- `POST /language/attempts/:attemptId/submit` — submit + grade an attempt
- `GET /language/attempts` — list attempts
- `GET /language/attempts/:attemptId/result` — attempt result

### Admin (auth + admin required)

- `GET /admin/users` — list users
- `PATCH /admin/users/:id/role` — promote/demote user admin role
- `DELETE /admin/users/:id` — delete user
- `GET /admin/stats` — global stats
- `GET /admin/passages` — list passages
- `POST /admin/passages` — create a default passage
- `DELETE /admin/passages/:id` — delete a passage
- `GET /admin/unseen` — list unseen passages
- `POST /admin/unseen` — create a manual unseen passage (with questions)
- `PATCH /admin/unseen/:id/publish` — publish/unpublish unseen passage
- `DELETE /admin/unseen/:id` — delete unseen passage

Admin language (mounted under `/admin/language`):

- `GET /admin/language/templates` — list templates
- `POST /admin/language/templates/generate` — generate a template via OpenRouter
- `PATCH /admin/language/templates/:templateId/publish` — publish/unpublish template
- `DELETE /admin/language/templates/:templateId` — delete template
- `GET /admin/language/templates/:templateId` — template detail

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
