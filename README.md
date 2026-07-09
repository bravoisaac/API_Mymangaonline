# API_Mymangaonline

Backend REST agregador para la app personal MyMangaOnline.

La API unifica resultados de múltiples fuentes de manga en un contrato estable que el frontend puede consumir sin depender de detalles internos de cada provider.

## Qué hace

- Busca manga por título en una fuente específica o en todas las fuentes habilitadas.
- Devuelve detalles, capítulos y páginas de capítulos.
- Proporciona proxy de imágenes para Comick, evitando bloqueos de hotlinking.
- Permite desactivar o activar fuentes mediante variables de entorno.

## Fuentes disponibles

- MangaDex
- Comick

Además, el proyecto incluye providers adicionales registrados como placeholders para extender la API fácilmente.

## Requisitos

- Node.js 20+
- npm

## Instalación

```bash
npm install
```

Copia el ejemplo de configuración y ajústalo según necesites:

```bash
cp .env.example .env
```

## Scripts

- `npm run dev` — inicia el servidor en modo desarrollo con `tsx watch`
- `npm run build` — compila TypeScript a `dist/`
- `npm start` — ejecuta la versión compilada
- `npm run lint` — valida tipos con TypeScript (`tsc --noEmit`)

## Variables de entorno

Copiar desde `.env.example` y configurar según el entorno.

### Ejemplo mínimo

```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*

MANGADEX_ENABLED=true
COMICK_ENABLED=true

MANGADEX_BASE_URL=https://api.mangadex.org
COMICK_BASE_URL=https://comick.live
COMICK_IMAGE_BASE_URL=https://meo.comick.pictures

REQUEST_TIMEOUT_MS=15000
MANGADEX_DEFAULT_LANGUAGE=es
DEFAULT_CHAPTER_QUALITY=data
```

### Opciones clave

- `PORT` — puerto en el que se expone la API.
- `CORS_ORIGIN` — origen permitido para CORS.
- `*_ENABLED` — habilita/deshabilita cada fuente.
- `DEFAULT_CHAPTER_QUALITY` — `data` o `data-saver` para MangaDex.

## Endpoints

Base: `http://localhost:3000/api`

### Health

- `GET /health`

### Fuentes y providers

- `GET /sources` — lista de fuentes del agregador.
- `GET /providers` — lista de providers habilitados.

### Búsqueda

- `GET /manga/search?q=<texto>&source=<source>&lang=<lang>` — busca en una fuente.
- `GET /manga/search/all?q=<texto>&lang=<lang>` — busca en todas las fuentes habilitadas.
- `GET /manga/search/:providerId?q=<texto>` — busca en un provider registrado.

### Catálogo y etiquetas

- `GET /manga/library?lang=<lang>&page=<n>&limit=<n>&tagIds[]=<id>&sort=<popular|recentlyUpdated>&source=<all|mangadex|comick>`
- `GET /manga/library/all?lang=<lang>&page=<n>&limit=<n>&tagIds[]=<id>&sort=<popular|recentlyUpdated>&source=<all|mangadex|comick>`
- `GET /manga/tags?lang=<lang>` — obtiene tags desde MangaDex.

### Manga, capítulos y páginas

- `GET /manga/:source/:id` — obtiene detalles de un manga.
- `GET /manga/:source/:id/chapters` — lista de capítulos de un manga.
- `GET /manga/:source/chapter/:chapterId/pages?quality=<data|data-saver>` — devuelve páginas de capítulo.

### Proxy de imágenes Comick

- `GET /proxy/image?url=<URL_IMAGEN_COMICK>` — reenvía la imagen con cabeceras esperadas por el CDN de Comick.

## Ejemplos

Buscar Naruto en MangaDex:

```bash
curl "http://localhost:3000/api/manga/search?q=naruto&source=mangadex&lang=es"
```

Buscar One Piece en Comick:

```bash
curl "http://localhost:3000/api/manga/search?q=one%20piece&source=comick&lang=es"
```

Buscar en todas las fuentes habilitadas:

```bash
curl "http://localhost:3000/api/manga/search/all?q=one%20piece&lang=es"
```

Obtener detalles de un manga:

```bash
curl "http://localhost:3000/api/manga/comick/<mangaId>?lang=es"
```

Obtener capítulos de un manga:

```bash
curl "http://localhost:3000/api/manga/mangadex/<mangaId>/chapters?lang=es"
```

Obtener páginas de un capítulo:

```bash
curl "http://localhost:3000/api/manga/mangadex/chapter/<chapterId>/pages?quality=data"
```

Proxy de imagen Comick:

```bash
curl -I "http://localhost:3000/api/proxy/image?url=<imagen_url>"
```

## Cómo usar

1. Configura `.env`.
2. Ejecuta `npm run dev`.
3. Prueba los endpoints con `curl`, Postman o el frontend.

## Arquitectura del proyecto

- `src/server.ts` — inicia el servidor.
- `src/app.ts` — configura middleware, rutas y manejo de errores.
- `src/routes/` — define rutas para `manga`, `sources`, `providers` y `proxy`.
- `src/controllers/` — maneja la lógica de cada endpoint.
- `src/services/` — agrega datos, gestiona providers y normaliza respuestas.
- `src/services/sources/` — implementa scrapers y adaptadores por fuente.
- `src/types/` — define contratos de respuesta.

## Tipos normalizados

La API devuelve objetos homogéneos para mantener consistencia entre fuentes:

- `NormalizedManga`
- `NormalizedMangaDetails`
- `NormalizedChapter`
- `NormalizedPage`

Los tipos se encuentran en `src/types/manga.types.ts`.

## Agregar una nueva fuente

1. Crea un servicio en `src/services/sources/`.
2. Implementa la interfaz `MangaSource`.
3. Normaliza la salida al contrato de `src/types/manga.types.ts`.
4. Registra la fuente en `src/services/mangaAggregator.service.ts`.
5. Añade la variable `NOMBRE_ENABLED` en `.env.example`.

## Notas importantes

- La API es para uso personal, educativo y de portafolio.
- No guarda imágenes ni capítulos en disco.
- El proxy de Comick evita bloqueos por hotlinking y envía cabeceras de `Referer`, `Origin` y `User-Agent`.
