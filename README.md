# Da Silva OS

Sistema operativo privado de **DA SILVA AUTOMOTORES** (Range Rover, Ford, Changan — Paraguay).
Centraliza inventario, ventas, clientes, financiaciones, cobranzas, mora, trade-in, compras,
gastos, caja y rentabilidad. Interfaz en español; moneda base PYG configurable, con USD.

> El sitio anterior del repositorio (landing «Vive para contarlo», sin relación con la
> concesionaria) se conservó sin cambios en `legacy/vive-para-contarlo/`.

## Módulos

| Módulo | Ruta | Qué hace |
|---|---|---|
| Dirección | `/direccion` | 10 indicadores con definición y fuente, «Atención requerida», gráficos con filtros |
| Aprobaciones | `/aprobaciones` | Descuentos, precios bajo mínimo, ajustes, refinanciaciones, tasaciones, facturas, gastos |
| Inventario | `/inventario` | Cinco estados independientes, costes, documentos, fotos, reservas, vistas salón/control |
| Ventas | `/ventas` | Constructor de operación, propuesta PDF, formalización con contrato y cronograma |
| Clientes | `/clientes` | Ficha 360°, duplicados, oportunidades con etapas configurables |
| Financiaciones | `/financiaciones` | Contratos, cronograma, estado de cuenta verificable, simulador |
| Cobranzas | `/cobranzas` | Cartera por tramo de mora, bandeja diaria, promesas, gestiones, pagos |
| Trade-in | `/tradein` | Tasación, inspección, revisión, decisión del cliente, ingreso a inventario |
| Compras | `/compras` | Proveedores, facturas, cuentas por pagar (registrado / confirmado / conciliado) |
| Gastos | `/gastos` | Gastos generales con aprobación previa y costes por unidad |
| Caja | `/caja` | Movimientos, transferencias, reversiones auditables, conciliación, tipos de cambio |
| Reportes | `/reportes` | 13 reportes con filtros y exportación CSV auditada |
| Auditoría | `/auditoria` | Registro inalterable con valor anterior y nuevo |
| Configuración | `/configuracion` | Parámetros, tramos de mora, usuarios y roles, catálogos |

## Demo en Vercel (sin configuración)

Si el proyecto se publica **sin variables de entorno**, la aplicación arranca sola como demo:

1. Importe el repositorio en Vercel (o `vercel --prod` desde la carpeta) y despliegue. Nada más.
2. Al abrir el enlace aparece «Demo de Da Silva OS»: se elige un rol (Director, Vendedor,
   Cobranzas…) y se entra sin contraseña.

La demo usa una base PostgreSQL embebida (PGlite) en la memoria del servidor, con las mismas
migraciones, permisos y funciones que la versión real, y los datos ficticios de demostración.
La primera visita tarda unos segundos mientras se prepara. Todo funciona (crear operaciones,
PDF, cobros, caja, reportes), pero los cambios vuelven al estado inicial cuando Vercel reinicia
el servidor, y no deben cargarse datos reales.

Para usar datos reales basta con definir `DATABASE_URL` y las variables de Supabase
([Despliegue](docs/DESPLIEGUE.md)): la demo embebida se desactiva automáticamente.

## Pila

Next.js 16 (App Router) · React 19 · TypeScript estricto · Tailwind CSS 4 · componentes propios ·
PostgreSQL (Supabase) con RLS y funciones transaccionales · Supabase Auth · Supabase Storage
privado · `@react-pdf/renderer` · Vitest · Playwright.

## Comandos

```bash
npm run dev          # servidor de desarrollo
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # pruebas unitarias (dominio financiero)
npm run test:db      # pruebas contra PostgreSQL (RLS, concurrencia, flujos)
npm run test:all     # unitarias + base de datos
npm run test:e2e     # punta a punta (requiere el stack local en ejecución)
npm run build        # compilación de producción
```

## Documentación

- [Desarrollo local](docs/DESARROLLO.md) — Postgres, Supabase Auth local, datos de demostración.
- [Despliegue](docs/DESPLIEGUE.md) — Supabase, variables de entorno, puesta en producción.
- [Arquitectura](docs/ARQUITECTURA.md) — capas, modelo de datos, concurrencia.
- [Seguridad](docs/SEGURIDAD.md) — roles, permisos, RLS, auditoría.
- [Indicadores](docs/INDICADORES.md) — fórmulas de cada KPI.
- [Financiación](docs/FINANCIACION.md) — convenciones de tasa, redondeo, aplicación de pagos.

## Datos de demostración

`npm run db:seed-demo` crea una organización **«Da Silva Automotores — DEMO»** marcada
`is_demo`, aislada por RLS de cualquier organización real y señalada en toda la interfaz con
la franja «DATOS DE DEMOSTRACIÓN». Sus valores son fijos (no aleatorios) y se cargan a través
de las mismas funciones que usa la aplicación. Nunca se ejecuta en producción.

## Pendiente de la empresa

- **Logotipo original**: colocar el archivo en `public/brand/` (ver `public/brand/README.md`) y
  calibrar `--color-brand` con su rojo exacto. Hasta entonces se muestra el nombre en texto.
- **Proyecto Supabase** y credenciales reales (ver [Despliegue](docs/DESPLIEGUE.md)).
- No existe integración bancaria ni con el BCP: los saldos de caja son **registrados** y la
  conciliación contra extractos es manual; los tipos de cambio se cargan a mano.
