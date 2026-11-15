# PROYECTO v2: Calendario armonizado de actividad de quema MODIS + VIIRS

Este documento es el prompt de trabajo para construir la aplicación con asistentes de código (vibecoding). Reemplaza al PROYECTO.docx original, que describía un monitor de incendios en tiempo real. Ese enfoque no responde al reto. El reto pide un **calendario histórico armonizado**.

Reto: NASA Space Apps Challenge 2026, "Harmonization of MODIS and VIIRS Hot Spots" (autora: CONAE, Argentina).
Página oficial: https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/

## 0. Objetivo en una frase

Construir una aplicación web que una los registros de puntos de calor de MODIS (2000 en adelante) y VIIRS (2012 en adelante) en **una sola serie consistente**, y la muestre como un **calendario mes × año** para un área elegida. La aplicación debe responder la pregunta guía del proyecto: **¿cambió el fuego, o cambió el satélite que lo observa?**

El reto pide, en sus propias palabras, que "the sensor of origin no longer matters", ver "which month and years had the highest fire activity" y "compare the burning activity of the current month against the historical median for a selected area". Cada una de esas frases debe verse cumplida en la demo.

## 1. Reglas no negociables

1. **Nada de marca NASA.** Sin logo de la NASA, sin "meatball" y sin llamar a la aplicación "FIRMS" ni "Sistema de Información sobre Incendios FIRMS". El nombre del proyecto lo decide el equipo; en el código se usa el marcador `[PROJECT_NAME]`. En la sección de créditos sí se cita "Data: NASA FIRMS" como fuente.
2. **Interfaz en inglés por defecto**, con selector de idioma ES. Las reglas de entrega exigen inglés.
3. **No mostrar hectáreas ni "área quemada" calculadas a partir de puntos de calor.** No existe metodología válida para eso. Las métricas son detecciones, celdas-día con fuego y FRP, siempre rotuladas por separado.
4. **Observado frente a estimado.** Todo valor armonizado se rotula como estimado e incluye su incertidumbre. Los valores crudos se rotulan como observados.
5. **"Sin sensor activo" nunca se muestra como cero.** Los meses sin cobertura se muestran como vacío o con trama, no como "0 fuegos".
6. **Ningún dato inventado.** Si faltan datos reales, la aplicación lo dice. Los datos de demostración, si existieran, se rotulan visiblemente como simulados.
7. **El asistente de IA no calcula ni recuerda cifras.** Solo responde con datos que devuelven sus herramientas y muestra los filtros que usó.
8. **Datos precalculados.** La aplicación pública no procesa millones de puntos en vivo. El pipeline genera archivos estáticos y la web los lee.

## 2. Alcance del MVP (hackathon, entrega domingo 15 nov 2026, 23:59)

**Regiones piloto:** Colombia (principal) y Argentina, a nivel nacional y por departamento/provincia.
**Casos demo precargados:** Chilecito, La Rioja (Argentina), julio 2026, el caso que mostró la autora del reto; Vichada (Colombia); Sierra Nevada de Santa Marta (Colombia).

**Fuera de alcance para la entrega** (se mencionan como "próximos pasos" en el pitch): PostGIS, Docker, tiles raster KDE, deduplicación por vecinos espacio-temporales, playback animado desde 2000, municipios, cobertura mundial, área quemada (MCD64A1), pronóstico.

## 3. Arquitectura

```
FIRMS archive CSV ──> Pipeline Python (offline) ──> JSON/Parquet estáticos ──> Web Next.js (Vercel)
                                                                          └──> API route /api/assistant (Claude)
```

| Capa | Tecnología |
|---|---|
| Pipeline | Python 3.12, DuckDB o Polars, pandas, scikit-learn (validación), GeoPandas solo para asignar celdas a departamento/provincia |
| Datos publicados | Archivos JSON (o Parquet) en `web/public/data/` |
| Frontend | Next.js + TypeScript + Tailwind + shadcn/ui |
| Mapa | MapLibre GL JS v5+ con **proyección de globo** (`projection: { type: 'globe' }`, `GlobeControl`, atmósfera con `sky`). Fondo satelital raster Sentinel-2 cloudless de EOX (uso no comercial, con atribución "Sentinel-2 cloudless by EOX") y estilo vectorial de OpenFreeMap para límites (sin token). terra-draw para polígonos (P2, en modo plano) y Turf.js |
| Gráficos | Apache ECharts (heatmap mes × año, series, bandas) |
| IA | Next.js API route + `@anthropic-ai/sdk`, con la API key en variable de entorno de Vercel (nunca `NEXT_PUBLIC_`) |
| Despliegue | GitHub (repo público) + Vercel |

Repositorio: monorepo con `/pipeline` (Python) y `/web` (Next.js).

## 4. Pipeline de datos y método de armonización

### 4.1 Entradas

Descarga del archivo histórico de FIRMS (Download Archived Data), en CSV, para la caja que cubre Colombia y Argentina:

- MODIS C6.1 (Terra desde nov 2000, Aqua desde jul 2002), producto estándar (no NRT), que incluye el campo `type`.
- VIIRS 375 m: S-NPP (`VNP14IMG`, desde ene 2012), NOAA-20 (`VJ114IMG`, desde 2018). NOAA-21 es opcional.
- Límites administrativos nivel 1 (departamentos y provincias): Natural Earth admin-1, de dominio público.

Nota: S-NPP dejó de producir datos nuevos en FIRMS el 2 nov 2026. El registro reciente continúa con NOAA-20.

### 4.2 Limpieza

1. Conservar solo `type == 0` (fuego de vegetación). Si falta `type`, aplicar la regla del paso 3.
2. Filtro de confianza: MODIS `confidence >= 30`; VIIRS `confidence in (nominal, high)`. Es una decisión de diseño documentada, no una equivalencia oficial.
3. Fuentes estáticas: eliminar celdas de ~1 km con detecciones en 50 o más días distintos del mismo año (regla tipo Giglio).
4. Separar día y noche con el campo `daynight`.
5. Todas las fechas en UTC y además en fecha local.

### 4.3 Unidad de conteo: celdas-día con fuego

Una cámara nítida genera más píxeles por el mismo fuego, así que no se cuentan píxeles crudos. Cada detección se asigna a una celda de ~1 km (grilla de 0,01°). La unidad es **celda de 1 km × día × día/noche × satélite con al menos una detección**. Luego se agregan esas celdas-día a la **celda de análisis de 0,1° × mes**.

### 4.4 Calibración (el "tipo de cambio")

- **Referencia:** Aqua MODIS, que pasa a la misma hora de la tarde que VIIRS (≈13:30).
- **Factor principal:** `k[región, mes_calendario, día/noche] = Σ celdas-día VIIRS S-NPP / Σ celdas-día Aqua MODIS`, sobre el solape **2012–2019**. Se excluyen los años finales por la deriva orbital de MODIS. La región es el departamento o la provincia.
- **Contracción (*shrinkage*):** si un estrato tiene pocas detecciones (por ejemplo, menos de 30 celdas-día de Aqua), se usa el factor de la región para todo el año, o el nacional.
- **NOAA-20 a S-NPP:** `k2[región, mes, día/noche] = NOAA-20 / S-NPP` sobre su solape (2018–oct 2026), con el mismo procedimiento.
- **Terra solo (nov 2000 a jun 2002):** escalar Terra a "equivalente Aqua" con la razón Aqua/Terra del período 2003–2008, por región.

### 4.5 Serie armonizada (en "equivalentes MODIS-Aqua")

| Período | Fuente usada | Conversión |
|---|---|---|
| nov 2000 a jun 2002 | Terra | × razón Aqua/Terra |
| jul 2002 a dic 2011 | Aqua | ninguna (es la referencia) |
| ene 2012 a oct 2026 | VIIRS S-NPP | ÷ k |
| nov 2026 en adelante | VIIRS NOAA-20 | ÷ k2 ÷ k |

Cada valor guarda su procedencia: sensor, satélite y factor aplicado. La incertidumbre se estima con la dispersión del factor entre años del solape (percentiles 5 y 95 de la razón anual por estrato).

### 4.6 Validación (debe verse en la aplicación)

1. **Dejar un año fuera:** para cada año de 2012 a 2019, recalcular k sin ese año, predecir el Aqua de ese año desde VIIRS y medir el error (MAPE y correlación). Se compara con "sin corregir".
2. **Prueba de la costura de 2012:** la razón media entre 2009–2011 y 2012–2014 en la serie cruda frente a la armonizada. El salto falso debe desaparecer.
3. Las métricas se publican en `validation.json` y se muestran en una pestaña "Method".

### 4.7 Calendario y anomalías

- **Línea base fija:** 2003–2022, por mes calendario: mediana, p10, p90 y media.
- **Anomalía de un mes:** diferencia frente a la mediana y posición percentil dentro de la línea base. Se indica siempre cuántos años la sustentan.
- **Indicadores:** mes pico climatológico, duración de temporada (meses con ≥10% del total anual climatológico) y año récord.

## 5. Contrato de datos (definirlo PRIMERO)

Archivos en `web/public/data/`:

```jsonc
// regions.json
[{ "id": "CO-VID", "name": "Vichada", "country": "CO", "bbox": [-71.1, 2.6, -67.4, 6.4] }]

// monthly/{region_id}.json  (una fila por mes)
[{
  "year": 2014, "month": 3,
  "raw_modis": 812,          // celdas-día observadas, MODIS (Terra+Aqua según período)
  "raw_viirs": 3410,         // celdas-día observadas, VIIRS (null antes de 2012)
  "harmonized": 851.2,       // equivalente MODIS-Aqua (estimado)
  "harmonized_p5": 760.0, "harmonized_p95": 940.0,
  "source": "VIIRS_SNPP", "factor": 4.01,
  "regime": "R3"             // R1 Terra, R2 Terra+Aqua, R3 MODIS+VIIRS
}]

// climatology/{region_id}.json  (12 filas)
[{ "month": 3, "median": 640.5, "p10": 210.0, "p90": 1320.0, "mean": 701.3, "n_years": 20 }]

// validation.json
{ "loyo": [{ "year": 2015, "mape_raw": 3.1, "mape_harmonized": 0.18, "r": 0.93 }],
  "seam_2012": { "raw_ratio": 4.6, "harmonized_ratio": 1.05 } }

// cells/{region_id}.json  (para mapa y polígonos)
[{ "cell": "0.1_-69.45_4.25", "lat": 4.25, "lon": -69.45, "year": 2014, "month": 3, "harmonized": 12.4 }]
```

Los nombres de campo de este contrato no se cambian sin avisar a todo el equipo.

## 6. Pantalla principal

Concepto visual: **"el ojo que mira la Tierra desde el espacio"**. Es una estética de centro de mando (HUD) sobre un globo satelital, inspirada en paneles de monitoreo global pero con diseño original. El **calendario sigue siendo la pieza central**: el globo es el envoltorio que atrapa la atención en los primeros segundos.

### 6.1 Flujo de la experiencia

1. **Pantalla de inicio:** globo 3D con atmósfera, girando lentamente sobre Sudamérica. Muestra la actividad de fuego armonizada (celdas de 0,1°) del último año y tiene la barra de IA abajo. Es la toma de apertura del video.
2. **Al elegir una región o un caso demo:** `map.flyTo()` vuela desde el espacio hasta la región. Al acercarse, la atmósfera se desvanece y el mapa se ve plano. Entonces **sube el panel del calendario** desde abajo.
3. **Al tocar una celda del calendario:** los contadores HUD y el mapa se actualizan a ese mes.
4. **Botón "Back to globe"** para volver a la vista orbital.

Rendimiento: la rotación automática se detiene cuando el usuario interactúa. En el globo nunca se dibujan puntos individuales, solo celdas agregadas.

### 6.2 Elementos de pantalla

- **Encabezado HUD** (sobre el mapa, sin barra sólida): `[PROJECT_NAME]` con tipografía espaciada, la frase "Did the fire change, or the satellite?", el selector EN/ES y la pestaña "Method".
- **Mini globo** en la esquina inferior izquierda, con la región seleccionada resaltada, la fecha activa del calendario y las coordenadas del centro.
- **Barra lateral derecha de contadores** (estilo HUD, cifras grandes): detecciones armonizadas del período, anomalía frente a la mediana (percentil), mes pico, año récord y **satélites activos en la fecha elegida** (Terra, Aqua, S-NPP, NOAA-20). Cada capa tiene un control de visibilidad (icono de ojo): MODIS crudo, VIIRS crudo, armonizado, límites, fondo satelital.
- **Panel izquierdo:** selector de región (país → departamento/provincia), casos demo con un clic, rango de años y entrada de lat/lon.
- **Centro:** globo/mapa MapLibre con las celdas de 0,1° coloreadas por actividad armonizada del período elegido y el contorno de la región.
- **Panel inferior (protagonista):** calendario heatmap **meses (columnas) × años (filas), 2001–2026**.
  - Paleta accesible *viridis* o *cividis*.
  - Totales por fila (año) y por columna (mes); mes pico y año récord resaltados.
  - Banda lateral de regímenes de sensores (R1/R2/R3) y una línea en 2012.
  - Clic en una celda: abre el detalle del mes (valor, mediana, percentil, procedencia, crudo frente a armonizado).
- **Interruptor grande "Raw / Harmonized"**: al cambiarlo, el calendario y una serie temporal pequeña se redibujan. En crudo se ve el salto de 2012; en armonizado desaparece. Es el momento estrella de la demo.
- **Tarjetas de indicadores:** mes actual frente a la mediana (diferencia y percentil), mes pico, duración de temporada, año récord.
- **Modo evento:** elegir una fecha (por ejemplo, julio 2026 en Chilecito) y ver su ranking frente al mismo mes de todos los años.
- **Botón "Download CSV"** con la tabla mensual (cruda, armonizada, procedencia) de la búsqueda.
- **Barra del asistente de IA** abajo al centro, tipo buscador ("Ask about fire activity…"). Al responder se expande en un panel translúcido.
- **Pestaña "Method":** explicación simple del método, métricas de validación (de `validation.json`), limitaciones y fuentes.

## 7. Prioridades

| Prioridad | Funcionalidad |
|---|---|
| P0 (imprescindible) | Pipeline completo para Colombia; contrato de datos; calendario heatmap; interruptor Raw/Harmonized; tarjetas de anomalía; CSV; pestaña Method con validación; despliegue público en Vercel |
| P1 (diferenciador) | Globo 3D con vuelo a la región y estilo HUD; asistente de IA con herramientas; Argentina y Chilecito; modo evento; mapa de celdas; selector EN/ES |
| P2 (si sobra tiempo) | Polígono dibujado por el usuario (suma de celdas con Turf); boletín automático precalculado por región; perspectiva estacional simple basada en la climatología |

## 8. Asistente de IA

Chat que **consulta los datos de la aplicación mediante herramientas** (tool calling) y puede cambiar los filtros de la pantalla.

- **Modelo:** Claude vía `@anthropic-ai/sdk` en una API route de Next.js. El modelo (`claude-opus-5-5` o `claude-haiku-5-5`) lo decide el equipo.
- **Herramientas** (leen los mismos JSON del contrato):
  - `get_monthly_series(region_id, start, end, mode)`: serie cruda o armonizada.
  - `get_anomaly(region_id, year, month)`: valor, mediana, percentil y número de años.
  - `get_ranking(metric, year, month, top)`: regiones con mayor actividad o anomalía.
  - `get_validation()`: métricas del método.
  - `set_view(region_id, start, end, mode)`: devuelve un parche de filtros que el frontend aplica.
- **Reglas del sistema:** responder solo con cifras devueltas por herramientas, con unidad, período, región y "harmonized" o "raw"; decir "no tengo datos" si una herramienta no los devuelve; no hacer pronósticos; responder en el idioma del usuario.
- **Seguridad y costo:** API key solo en el servidor; límite simple de pedidos por minuto; los boletines de los casos demo se precalculan en el build para que la demo no dependa de la API.
- El texto generado se rotula "AI-generated" en la interfaz.

## 9. Diseño visual

- **Estética HUD de centro de mando** sobre el globo satelital: fondo espacial oscuro, paneles translúcidos con desenfoque (`backdrop-filter: blur`), bordes finos con brillo suave, tipografía monoespaciada para cifras y coordenadas, y un reloj con la fecha activa. No se usan logos institucionales.
- **Regla de oro: mucho estilo en el marco, poco ruido en los datos.** El brillo y los acentos de color (cian o ámbar) van solo en bordes, botones e iconos del HUD. Los datos de fuego usan siempre paletas accesibles (*viridis*, *cividis* o una escala de fuego apta para daltónicos). Se evita el arcoíris azul-magenta-amarillo del mockup. Nunca se muestran miles de iconos a la vez: la pantalla debe entenderse en 5 segundos.
- Diseño original: se toma la idea de un panel HUD global, pero no se copian el layout, la marca ni los textos de productos existentes.
- Atribuciones visibles en el pie del mapa: "Sentinel-2 cloudless by EOX", "© OpenFreeMap © OpenStreetMap contributors" y "Fire data: NASA FIRMS".
- Tipografía legible y cifras grandes en los contadores.
- Responsivo: funcional en laptop y tablet; en celular basta con calendario y tarjetas.

## 10. Criterios de aceptación (checklist de la demo)

- [ ] La aplicación abre en el globo con atmósfera y, al elegir Vichada, vuela hasta la región.
- [ ] Elegir Vichada muestra el calendario 2001–2026 en menos de 2 segundos.
- [ ] El interruptor Raw/Harmonized hace aparecer y desaparecer el salto de 2012.
- [ ] La pestaña Method muestra el error con y sin armonizar (dejando un año fuera).
- [ ] Chilecito, julio 2026, muestra su posición frente a los julios anteriores.
- [ ] El CSV descargado coincide con lo que muestra el calendario.
- [ ] Ningún mes sin sensor aparece como 0.
- [ ] El asistente responde "¿Was March 2026 in Vichada unusual?" con cifras y cambia la vista.
- [ ] El link público abre sin login en una ventana de incógnito.
- [ ] No aparece ningún logo NASA ni el nombre "FIRMS" como nombre del producto.

## 11. Instrucciones para el asistente de código

1. Trabajar por pasos pequeños y verificables. Primero el contrato de datos con datos reales de una región, luego la interfaz.
2. El pipeline incluye pruebas básicas: sin claves duplicadas, conservación de filas, factores k dentro de un rango razonable (aproximadamente 1 a 10) y salto de 2012 reducido en la serie armonizada.
3. No inventar datos ni valores de ejemplo en la interfaz. Si un archivo falta, mostrar un estado vacío explícito.
4. No usar logos ni marcas de la NASA.
5. Mantener la API key fuera del cliente.
6. Documentar en el README: método, fuentes de datos, limitaciones y una sección "AI usage" que declare el uso de asistentes de código y del modelo de lenguaje en el producto.
