# GPI — Gestión de Pedidos Intercompañía
Versión: v0.1.9 Alpha

## Incluye
- Pantalla inicial: Nuevo pedido.
- Búsqueda por código o descripción sobre el catálogo maestro.
- Prioridad por orden de selección y reordenamiento táctil mediante arrastre.
- Borrador → Enviado → Recibido completo / Recibido incompleto.
- Catálogo Activo/Inactivo.
- Restauración protegida por clave administrativa + motivo.
- Deshacer al inactivar, eliminar línea o mover prioridad.
- Sugerencia automática del siguiente PO una vez exista el primer PO guardado.
- Formato PO: PO###-MMMDD-AAAA, por ejemplo PO193-AGO18-2026.
- Exportación CSV para Sage con Vendor ID 100, Number of Distributions calculado por cantidad real de líneas y Amount = Quantity × Unit Price.
- Compartir CSV mediante la hoja de compartir de Android cuando el navegador lo soporte.
- PWA con service worker y almacenamiento local persistente mediante IndexedDB.
- Columna Pallets preparada, todavía desconectada.

## Datos técnicos
El catálogo inicial se cargó desde `CATALOGO COMPLETO.xlsx`.
Productos cargados: 584.

Los campos G/L Account, Unit Price y Accounts Payable Account no se muestran en las pantallas operativas, pero son usados para construir el CSV.

## Importante
1. La app debe servirse por HTTPS (por ejemplo Vercel) o localhost para que el service worker/PWA funcione correctamente.
2. Esta Alpha almacena pedidos, catálogo y clave localmente en la tablet mediante IndexedDB. No sincroniza entre dispositivos.
3. Los datos técnicos están ocultos en la interfaz, pero al ser una app 100 % cliente no constituyen seguridad criptográfica frente a alguien con acceso técnico al navegador. Para confidencialidad real y sincronización se debe conectar la siguiente versión a un backend/Firestore.
4. Los productos agregados manualmente desde la interfaz no tienen G/L Account ni Unit Price; GPI bloqueará su exportación a Sage hasta completar esos datos por una futura actualización/importación de catálogo.
5. El manifiesto no incluye iconos personalizados. Se dejó así para no crear arte/iconografía sin aprobación explícita.


## Cambios v0.1.1
- Interfaz corporativa más plana: radios mínimos, sin tarjetas flotantes ni sombras decorativas.
- Se eliminó el botón redundante `Exportar para Sage`.
- `Compartir CSV` genera directamente el archivo compatible con Sage y abre Compartir.
- `Enviar pedido` pasó a llamarse `Guardar pedido`.
- `Guardar pedido` cambia el estado a ENVIADO, conserva la orden en Pedidos y limpia Nuevo pedido.
- Al limpiar la pantalla se sugiere automáticamente el siguiente número secuencial de PO.
- Compartir CSV no cambia el estado del pedido.


## Cambios v0.1.2
- Navegación superior sin bloques de color.
- La pestaña activa se identifica únicamente con una línea roja inferior.
- La línea activa cambia suavemente al cambiar de pestaña.
- Guardar borrador, Compartir CSV y Guardar pedido permanecen negros.
- Los botones inferiores cambian a rojo únicamente mientras están siendo presionados.


## Cambios v0.1.3
- Pedidos ahora tiene botón Ver para abrir el detalle completo de cada orden.
- El detalle conserva prioridad, cantidades pedidas, recibidas y diferencia.
- Los faltantes se resaltan visualmente.
- Desde una orden ENVIADA puede registrarse la recepción.
- Si todas las cantidades recibidas cubren lo pedido: RECIBIDO COMPLETO.
- Si al menos una línea llega por debajo: RECIBIDO INCOMPLETO.
- Se guarda observación general de recepción.
- El detalle histórico muestra cajas pedidas, recibidas y cantidad de líneas faltantes.
- Las órdenes ya cerradas pueden consultarse sin alterar el pedido original.


## Cambios v0.1.4
- Catálogo incorpora `Actualizar catálogo`.
- Importación/actualización desde CSV exportado de Sage.
- Comparación por Item ID.
- Actualiza Description, U/M ID, G/L Account, Unit Price y Accounts Payable Account.
- Los códigos nuevos se agregan como Activos.
- Los productos existentes conservan su estado Activo/Inactivo.
- Importar un catálogo nuevo NO reactiva un código inactivo.
- Los códigos ausentes del archivo NO se eliminan ni se inactivan automáticamente.
- Los productos agregados manualmente se completan automáticamente si posteriormente aparecen en el CSV de Sage.
- Vista previa con cantidad de códigos nuevos, actualizados, inactivos preservados y observaciones.
- Deshacer disponible inmediatamente después de aplicar una actualización.
- Se registra la actualización en la auditoría local.
- La actualización maestra acepta CSV, que es el formato recomendado para las exportaciones periódicas desde Sage.


## Corrección v0.1.5
- La app ahora puede abrirse directamente con doble clic (`file://`) para pruebas en PC.
- El catálogo maestro quedó embebido dentro de la app, por lo que ya no depende de `fetch("catalog.json")` al abrir localmente.
- Manifest y Service Worker solo se activan cuando GPI se sirve por HTTP/HTTPS.
- Esto elimina los bloqueos CORS que impedían iniciar JavaScript y hacían que los botones no respondieran.
- Para instalar GPI como PWA en la tablet sigue siendo necesario publicarla por HTTPS.


## Cambios v0.1.6
- Corregido el botón Cancelar de los formularios: ya no dispara la validación de campos obligatorios.
- Cancelar ahora es una acción visualmente discreta, sin bloque negro.
- Ajustado el ancho de las filas del catálogo para evitar que el texto de los botones se corte.
- El botón de catálogo ahora se muestra como `Eliminar`.
- `Eliminar` no borra físicamente el código: lo mueve a Inactivos, conserva el historial y permite restaurarlo con clave administrativa.
- U/M se mantiene visible porque corresponde a `U/M ID` (empaque/unidades por caja) y no interfiere con `U/M No. of Stocking Units`, que la exportación genera aparte como 1.00.


## Cambios v0.1.7
- Se recupera la acción `Inactivar` como función independiente.
- Se añade una acción separada `Eliminar` para borrar definitivamente del catálogo maestro.
- Inactivar mueve el código a Inactivos y conserva la posibilidad de restaurarlo.
- Eliminar quita el código del catálogo, pero los pedidos históricos mantienen sus datos.
- Ambas acciones ahora son iconos pequeños y minimalistas con tooltip.
- `Actualizar catálogo` y `Agregar producto` pasan a controles compactos, sin botones grandes.


## Cambios v0.1.8
- Actualizar catálogo y Agregar producto ahora son acciones discretas tipo toolbar con icono + texto.
- Sin bloques de fondo negro/rojo ni mayúsculas forzadas.
- El rojo aparece solo durante la interacción.


## Corrección v0.1.9
- Aplicada realmente la barra minimalista de acciones del catálogo.
