# Enterprise Control Center (ECC)

Платформа управления ИТ-активами, реестром лицензий ПО, заявками на обслуживание, сотрудниками, аудитом и эксплуатационной готовностью организации.

> **Статус разработки:** реализованы базовый функционал **Community Edition**, операционные механизмы защиты и резервного копирования (**Phase 2**) и модульный контур коммерческого лицензирования и SLA-отчётности (**Phase 3**). Развёртывание в реальной промышленной среде требует настройки внешней инфраструктуры (TLS reverse proxy, внешние ключи `ECC_SECRET_KEY` / `ECC_LICENSE_SIGNING_KEY`, внешнее хранилище бэкапов) и независимого аудита безопасности (см. `docs/ROADMAP.md` и `docs/PRODUCTION-DEPLOYMENT.md`).

## Архитектура (текущий runtime)

- **Backend:** Node.js 22+, TypeScript, Express (`server.ts`, модули в `server/`, например `server/licensing.ts`)
- **Frontend:** React 19, TypeScript, Vite (`src/App.tsx`, `src/api.ts`)
- **Хранилище состояния:** файловое JSON-хранилище (`ECC_DATA_DIR/ecc_store.json`) и локальные снимки (`ECC_DATA_DIR/backups/` с sidecar-файлами `.sha256`)
- **Безопасность API и сессий:**
  - `scrypt`-хеширование паролей
  - Подписанные HMAC-SHA256 Bearer-токены (TTL 5–60 мин, по умолчанию `20` мин) с отзывом через `token_version`
  - Ограничение частоты попыток входа по `X-Real-IP` (`AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_SECONDS`)
  - Изоляция тенантов (`organization_id`) и RBAC (`admin`, `editor`, `viewer`)
  - Заголовки безопасности HTTP, строгий `CORS_ORIGINS`, оптимистическая блокировка версий и защита формул при экспорте CSV

> Примечание: в ранних документах (`docs/DATABASE.md`, `docs/SECURITY.md`) описана целевая контейнерная архитектура миграции на Python/FastAPI/PostgreSQL/Redis; актуальный рабочий код в данном репозитории построен на TypeScript/Node.js/Express + Vite.

## Локальный запуск и проверка

Требуется Node.js 22+ и npm 10+.

```bash
npm install
npm run lint
npm test
npm run build
npm start
```

По умолчанию сервер запускается на `http://127.0.0.1:3000`. Проверка работоспособности: `GET /health`.

Ключевые переменные окружения описаны в `.env.example` и `docs/INSTALL-AND-UPGRADE.md`:
- `ECC_PORT` (по умолчанию `3000`)
- `ECC_DATA_DIR` (по умолчанию `./var/ecc-data`)
- `ECC_SECRET_KEY` (ключ подписи Bearer-токенов, от 32 байт)
- `ECC_LICENSE_SIGNING_KEY` (ключ верификации офлайн-лицензий `ECC1`, от 32 байт)
- `ACCESS_TOKEN_MINUTES` (`5..60`, по умолчанию `20`)
- `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_SECONDS`
- `CORS_ORIGINS` (явный список разрешённых HTTPS origins, `*` запрещён)
- `ECC_BACKUP_RETENTION_COUNT` (по умолчанию `10`)
- `ECC_STRUCTURED_LOGS` (`true` для stdout JSON логов)

## Редакции (Community vs Commercial)

- **Community Edition:** базовый учёт, RBAC, CSV, аудит, SHA-256 бэкапы/снимки и DR-учения с квотами (до 10 пользователей, 250 активов, 50 лицензий ПО).
- **Professional / Enterprise Edition:** расширенные или безлимитные квоты, автономная активация подписанных ключей `ECC1`, расчётный отчёт SLA/соответствия (`/api/v1/enterprise/sla-report`) и выгрузка обезличенного пакета поддержки (`/api/v1/enterprise/support-bundle`). Подробнее в `docs/EDITION-BOUNDARIES.md`.

## Структура проекта

```text
server.ts                     Точка входа API и Vite/SPA
server/licensing.ts           Границы редакций, квоты, верификация лицензий ECC1, SLA-отчётность
src/App.tsx                   Веб-интерфейс ECC
src/api.ts                    Типизированный API-клиент
scripts/test-ecc.ts           Интеграционные и security-тесты (npm test)
docs/
  ROADMAP.md                  Дорожная карта и статус этапов
  EDITION-BOUNDARIES.md       Границы Community / Professional / Enterprise
  INSTALL-AND-UPGRADE.md      Установка, резервное копирование перед обновлением, апгрейд и откат
  PRODUCTION-DEPLOYMENT.md    Чек-лист безопасного развёртывания
  licensing/                  Проектные юридические черновики и аудит зависимостей
```


## Первичная настройка администратора

Новая установка требует задать `ECC_BOOTSTRAP_ADMIN_EMAIL`, `ECC_BOOTSTRAP_ADMIN_NAME` и `ECC_BOOTSTRAP_ADMIN_PASSWORD` через менеджер секретов или защищённое окружение развёртывания. Длина пароля: 12–128 символов. Встроенных паролей администратора, редактора и наблюдателя нет. Каталог рабочей БД по умолчанию: `var/ecc-data`; в production задайте `ECC_DATA_DIR` как постоянный каталог вне Git-рабочей копии. Перед обновлением установки со старым `data/ecc_store.json` изучите [руководство по установке и миграции](docs/INSTALL-AND-UPGRADE.md).
