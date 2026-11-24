# MELO_LOVE — База сюжетных основ (Этап 1)

Интеллектуальная библиотека жизненных сюжетов о любви и отношениях с проверкой смысловой уникальности, критической оценкой качества (0–100) и пакетной генерацией для последующих публикаций в Яндекс Дзене.

## Стек и структура

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Backend:** Express (`server.ts`), Vite middleware (dev) / static `dist/` (prod)
- **AI-генерация партий:** `@google/genai` (`gemini-4-hydrogen`) на серверной стороне
- **Хранение на Этапе 1:** локальный JSON на диске (`data/melo_love_db.json`), промежуточная очередь проверки (`data/pending_batch.json`), ротация снимков (`data/backups/`)

Подробная техническая документация этапа находится в файле `MELO_LOVE_SUMMARY.txt`.

## Быстрый старт (локально или после клонирования из GitHub)

```bash
npm install
cp .env.example .env
# Укажите GEMINI_API_KEY в файле .env
npm run dev
```

Приложение откроется на `http://localhost:3000`.

### Сборка и запуск в production

```bash
npm run build
npm start
```

## Переменные окружения

См. `.env.example`:
- `GEMINI_API_KEY` — ключ Gemini API (используется только на сервере в `server/geminiBatch.ts`).
- `PORT` — порт Express-сервера (по умолчанию `3000`).

## Дальнейшее развитие (Этап 2+)

1. **Расширение в текущем проекте:** новые модули (генератор публикаций, SEO, Telegram, фото) подключаются поверх текущей базы, используя поле `usageStatus` (`unused` -> `drafted` -> `published` -> `archived`) и REST API (`/api/database`, `/api/stories/:id/status`).
2. **Миграция в Supabase:** готовая SQL-схема `public.melo_story_plots` доступна в `src/shared/similarity.ts` и во вкладке **«Экспорт базы»**.
3. **GitHub Actions:** после переноса в GitHub и подключения Supabase фоновые задачи (автопроверка, бэкапы, публикации) выносятся в `.github/workflows/`.
