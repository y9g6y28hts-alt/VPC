# Integración: disponibilidad de lotes desde el sistema de Génesis

Cuando en el sistema de Génesis un lote pasa a **vendido**, **reservado** o **disponible**, la web lo muestra sola: en el plano interactivo, en la lista de lotes y en la ficha de cada lote, también dentro del recorrido 3D. Nadie tiene que tocar la web.

## Qué lee la web

Un solo documento JSON, con este formato:

```json
{
  "desarrollo": "viva-lago-country",
  "actualizado": "2026-11-22T18:30:00-03:00",
  "fuente": "Sistema de gestión de Génesis",
  "lotes": {
    "C-02": "vendido",
    "B-05": "reservado",
    "A-01": "disponible"
  }
}
```

- **Lotes**: el código es manzana + número de dos cifras, como en el plano (`A-01` … `E-07`). La lista completa está en `js/data/masterplan.js`. Si el sistema usa la numeración del folleto (manzanas 1–5), la equivalencia es 1 = C, 2 = D, 3 = B, 4 = E y 5 = A.
- **Estados**: `vendido`, `reservado` o `disponible` (también acepta `sold`, `reserved` o `available`). Un lote que no aparece en la lista se muestra como **“Consultar”**.
- **actualizado**: fecha y hora de la última modificación, en formato ISO 8601. La web la muestra debajo del plano.
- **fuente**: un texto corto que aparece en la ficha del lote (“Estado según: …”).

Solo viajan códigos de lote y estados. **No hay que enviar compradores, precios ni ningún dato personal**: la web ignora cualquier otro campo, y tampoco conviene exponerlo.

La web valida el documento. Si no lo puede leer (sistema caído, formato incorrecto o demora de más de 5 segundos), mantiene los últimos estados documentados y sigue funcionando.

## Opción A — En vivo, desde el sistema (recomendada)

El sistema publica una URL de **solo lectura** que devuelve ese JSON. Por ejemplo:

```
GET https://sistema.genesis.com.py/api/public/viva-lago/disponibilidad
```

Requisitos de esa URL:

1. Que sea **HTTPS** y responda `200` con `Content-Type: application/json`.
2. Que tenga **CORS** habilitado para el dominio de la web:
   `Access-Control-Allow-Origin: https://www.su-dominio.com.py`
3. Que sea pública, sin login, y que **solo devuelva estados de lotes**.
4. Opcional: `Cache-Control: max-age=30`.

Después, en la web, se completa una sola línea en `js/config/site.js`:

```js
availabilityUrl: 'https://sistema.genesis.com.py/api/public/viva-lago/disponibilidad',
```

La web consulta esa URL al abrirse y **una vez por minuto** mientras la página está visible. Un lote marcado como vendido en el sistema aparece vendido en la web en menos de un minuto, incluso para quien ya la tiene abierta.

Ejemplo de endpoint (Node.js + Express). Se adapta a la base de datos que use el sistema:

```js
app.get('/api/public/viva-lago/disponibilidad', async (req, res) => {
  const filas = await db.query(
    "SELECT codigo, estado, actualizado FROM lotes WHERE desarrollo = 'viva-lago-country'"
  );
  const lotes = Object.fromEntries(filas.map((f) => [f.codigo, f.estado])); // 'vendido' | 'reservado' | 'disponible'
  const actualizado = filas.reduce((max, f) => (f.actualizado > max ? f.actualizado : max), new Date(0));
  res.set('Access-Control-Allow-Origin', 'https://www.su-dominio.com.py');
  res.set('Cache-Control', 'max-age=30');
  res.json({ desarrollo: 'viva-lago-country', actualizado: actualizado.toISOString(), fuente: 'Sistema de gestión de Génesis', lotes });
});
```

## Opción B — Sin publicar nada desde el sistema

Si el sistema no puede tener una URL pública, puede **actualizar el archivo `data/disponibilidad.json` del repositorio** cada vez que cambia un estado. Vercel vuelve a publicar la web sola en aproximadamente un minuto.

El sistema lo hace con la API de GitHub. Se necesita un token con permiso de escritura solo sobre este repositorio, guardado en el servidor del sistema y nunca en la web:

```bash
# 1. Obtener el sha actual del archivo
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/<owner>/<repo>/contents/genesis/data/disponibilidad.json?ref=<rama> | jq -r .sha

# 2. Subir el contenido nuevo (en base64) con ese sha
curl -s -X PUT -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/<owner>/<repo>/contents/genesis/data/disponibilidad.json \
  -d '{"message":"Disponibilidad: C-02 vendido","branch":"<rama>","sha":"<sha>","content":"<json en base64>"}'
```

Mientras `availabilityUrl` esté en `null`, la web lee este archivo. Hoy marca C-02 como vendido, según el folleto de marzo de 2026.

## Cómo probarlo

1. Cambiar un estado en el sistema (opción A) o en `data/disponibilidad.json` (opción B).
2. Abrir la página de Viva Lago Country, en la sección **Lotes**: el lote aparece con su color en el plano (verde: disponible; ámbar: reservado; gris: vendido), con su estado en la lista y, debajo del plano, el resumen y la fecha (“1 vendido — actualizado el 22 de noviembre”).
3. Las pruebas automáticas del proyecto (`npm test`) verifican el formato y que los datos inválidos se descarten.
