# API_Mymangaonline

Backend REST agregador para la app personal MyMangaOnline. La API normaliza resultados de distintas fuentes de manga para que el frontend consuma un contrato estable.

Las fuentes reales implementadas son MangaDex y Comick. Las demas fuentes quedan registradas como placeholders deshabilitados para agregarlas despues sin cambiar la arquitectura principal.

## Uso personal

Este proyecto esta pensado para uso personal, educativo y de portafolio. No guarda imagenes ni capitulos en disco. Para Comick puede transmitir imagenes por proxy porque su CDN puede bloquear hotlinking directo desde la app.

## Instalacion

```bash
npm install
```

Copia `.env.example` a `.env` y ajusta las variables si lo necesitas.

## Variables de entorno

```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*

MANGADEX_ENABLED=true
INMANGA_ENABLED=false
LEERMANGA_ENABLED=false
TUMANGAONLINE_ENABLED=false
COMICK_ENABLED=true
MANGA_SCRAPER_ENABLED=false
MANGPI_ENABLED=false

MANGADEX_BASE_URL=https://api.mangadex.org
COMICK_BASE_URL=https://comick.live
COMICK_IMAGE_BASE_URL=https://meo.comick.pictures

REQUEST_TIMEOUT_MS=15000

MANGADEX_DEFAULT_LANGUAGE=es
DEFAULT_CHAPTER_QUALITY=data
```

`DEFAULT_CHAPTER_QUALITY` acepta `data` o `data-saver`.

## Scripts

```bash
npm run dev
npm run build
npm start
npm run lint
```

## Endpoints

### Estado

```bash
curl http://localhost:3000/api/health
```

### Fuentes disponibles

```bash
curl http://localhost:3000/api/sources
```

### Buscar manga en una fuente

MangaDex:

```bash
curl "http://localhost:3000/api/manga/search?q=naruto&source=mangadex&lang=es"
```

Comick:

```bash
curl "http://localhost:3000/api/manga/search?q=one%20piece&source=comick&lang=es"
```

Si `source` no viene, usa `mangadex`.

### Buscar en todas las fuentes habilitadas

```bash
curl "http://localhost:3000/api/manga/search/all?q=one%20piece&lang=es"
```

Si una fuente falla, la respuesta incluye el error en `errors` y conserva los resultados de las demas fuentes.

### Detalle de manga

MangaDex:

```bash
curl "http://localhost:3000/api/manga/mangadex/ID_DEL_MANGA?lang=es"
```

Comick:

```bash
curl "http://localhost:3000/api/manga/comick/HID_DEL_MANGA?lang=es"
```

### Capitulos

MangaDex:

```bash
curl "http://localhost:3000/api/manga/mangadex/ID_DEL_MANGA/chapters?lang=es"
```

Comick:

```bash
curl "http://localhost:3000/api/manga/comick/HID_DEL_MANGA/chapters?lang=es"
```

### Paginas de capitulo

MangaDex:

```bash
curl "http://localhost:3000/api/manga/mangadex/chapter/ID_DEL_CAPITULO/pages?quality=data"
```

Comick:

```bash
curl "http://localhost:3000/api/manga/comick/chapter/HID_DEL_CAPITULO/pages"
```

`quality` acepta `data` o `data-saver` para MangaDex. Comick devuelve las URLs de imagen disponibles desde su API.

### Proxy de imagen Comick

La app usa este endpoint automaticamente para imagenes de Comick:

```bash
curl -I "http://localhost:3000/api/proxy/image?url=URL_IMAGEN_COMICK"
```

Reemplaza `URL_IMAGEN_COMICK` por una URL devuelta en `pages[0].url`. El proxy solo acepta hosts de imagen conocidos de Comick y envia `Referer`, `Origin` y `User-Agent` para evitar bloqueos de hotlinking.

## Pruebas manuales

Levanta la API:

```bash
npm run dev
```

Valida estado y fuentes:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/sources
```

MangaDex debe funcionar con la configuracion por defecto:

```bash
curl "http://localhost:3000/api/manga/search?q=naruto&source=mangadex&lang=es"
```

Comick necesita estar habilitado. Para probarlo, usa:

```env
COMICK_ENABLED=true
```

Luego reinicia el servidor y ejecuta:

```bash
curl "http://localhost:3000/api/manga/search?q=one%20piece&source=comick&lang=es"
curl "http://localhost:3000/api/manga/search/all?q=one%20piece&lang=es"
curl "http://localhost:3000/api/manga/comick/HID_DEL_MANGA?lang=es"
curl "http://localhost:3000/api/manga/comick/HID_DEL_MANGA/chapters?lang=es"
curl "http://localhost:3000/api/manga/comick/chapter/HID_DEL_CAPITULO/pages"
curl -I "http://localhost:3000/api/proxy/image?url=URL_IMAGEN_COMICK"
```

Reemplaza `HID_DEL_MANGA` y `HID_DEL_CAPITULO` con los `id` devueltos por Comick. En Comick el `id` normalizado de manga corresponde al `slug` de su API.

Nota: Comick puede bloquear llamadas server-side con HTTP 403. Si ocurre, la API devolvera un error controlado para esa fuente y MangaDex seguira funcionando. Para usar Comick en ese caso, configura `COMICK_BASE_URL` con un proxy/base URL compatible que exponga los mismos endpoints de Comick.

## Contratos normalizados

La API devuelve mangas, detalles, capitulos y paginas con campos estables:

- `NormalizedManga`
- `NormalizedMangaDetails`
- `NormalizedChapter`
- `NormalizedPage`

Los tipos estan definidos en `src/types/manga.types.ts`.

## Agregar una nueva fuente

1. Crea o completa un servicio en `src/services/sources`.
2. Implementa la interfaz `MangaSource`.
3. Normaliza los datos al contrato de `src/types/manga.types.ts`.
4. Registra la fuente en `src/services/mangaAggregator.service.ts`.
5. Agrega una variable `NOMBRE_ENABLED` en `.env.example`.

Las fuentes no implementadas deben lanzar `SourceNotImplementedError` para evitar que una integracion incompleta rompa toda la API.
