# OBSERVA

Система мониторинга цен конкурентов 24/7. Desktop-приложение на **Electron + React + Vite + TypeScript**.

## Возможности

- Мониторинг цен товаров в интернет-магазинах
- Сравнение цен между магазинами
- Аналитика и история цен
- Уведомления через Telegram
- Экспорт данных в Excel

## Требования

- **Node.js** >= 18 (рекомендуется LTS 20+)
- **npm** >= 9 (идёт в комплекте с Node.js)
- Windows / macOS / Linux

## Установка и запуск

```bash
# 1. Клонировать репозиторий
git clone https://github.com/rbmus/observa.git
cd observa

# 2. Установить зависимости
npm install

# 3. Запустить в режиме разработки (Vite + Electron)
npm run dev
```

## Сборка

```bash
# Сборка фронтенда
npm run build

# Сборка установщика (Windows .exe через electron-builder)
npm run dist
```

Готовый установщик появится в папке `release/`.

## Структура проекта

```
├── electron/          # Electron main process и сервисы
│   ├── main.cjs       # Точка входа Electron
│   ├── preload.cjs    # Preload-скрипт (IPC bridge)
│   └── services/      # Парсеры, анализатор цен, Telegram и др.
├── src/               # React-приложение (UI)
│   ├── components/    # UI-компоненты
│   ├── pages/         # Страницы (Dashboard, Stores, Analytics...)
│   └── types.ts       # TypeScript-типы
├── index.html
├── vite.config.ts
└── package.json
```

## Полезные команды

| Команда | Описание |
|---|---|
| `npm run dev` | Запуск в режиме разработки |
| `npm run vite` | Только фронтенд (без Electron) на http://127.0.0.1:5173 |
| `npm run build` | Сборка фронтенда в `dist/` |
| `npm start` | Запуск собранного приложения через Electron |
| `npm run dist` | Сборка установщика |
