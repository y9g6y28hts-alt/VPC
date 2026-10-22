# Indicadores

Cada indicador de la interfaz tiene un ícono ⓘ con esta misma definición y su fuente.
Los valores **estimados** o **proyectados** llevan una etiqueta visible; los demás son
**registrados**. Ningún saldo de caja se presenta como saldo bancario verificado: sólo el
saldo **conciliado** fue contrastado con un extracto.

Moneda base: la de la organización (PYG). Importes en USD: convertidos con el tipo de cambio
fijado en la operación (ventas, costes) o con el último tipo de cambio registrado (saldos),
en cuyo caso el valor es referencial.

## Tablero de Dirección (`/direccion`)

Filtros: período (mes actual, mes anterior, últimos 3, 6 o 12 meses, año en curso), marca y vendedor.
Las cifras de flujo usan el período; los saldos e inventario, el estado a hoy.

| Indicador | Fórmula | Fuente | Tipo |
|---|---|---|---|
| Unidades en inventario | Unidades con disponibilidad «Disponible» o «Reservado» | Inventario | registrado |
| Valor de adquisición | Σ coste de adquisición registrado de esas unidades (el subtítulo muestra el coste total con transporte, reparaciones, etc.) | Costes por unidad | registrado |
| Ventas del período | Σ precio de venta de contratos firmados en el período. Facturación comprometida, no cobro | Contratos | registrado |
| Cobros confirmados | Σ pagos de clientes CONFIRMADOS con fecha de cobro en el período (sin usados ni notas de crédito) | Pagos | registrado |
| Cuentas por cobrar | Σ saldo de contratos vigentes = cuotas − aplicaciones de pagos confirmados | Cuotas y aplicaciones | registrado |
| Deuda vencida | Σ saldo de cuotas con vencimiento anterior a hoy, contratos vigentes; subtítulo: % de la cartera | Cuotas y aplicaciones | registrado |
| Cuentas por pagar | Σ (importe − pagos confirmados) de facturas aprobadas + gastos aprobados sin pagar | Facturas y gastos | registrado |
| Margen estimado del inventario | Σ (precio de lista en moneda base − costes registrados y estimados). Supone venta a precio de lista | Inventario y costes | **estimado** |
| Margen bruto de operaciones cerradas | Σ (precio de venta − costes de la unidad) de operaciones entregadas en el período. Estimado si alguna tiene costes sin factura. Sin intereses de financiación | Operaciones y costes | registrado / estimado |
| Pendientes de entrega | Unidades con venta formalizada sin entrega física registrada | Inventario y ventas | registrado |

**Atención requerida**: cuotas vencidas, promesas incumplidas, pagos informados sin confirmar,
aprobaciones pendientes, reservas por expirar, ventas pendientes de entrega, documentación
incompleta, inventario envejecido (más días que el umbral de Configuración), costes estimados
sin factura, facturas de proveedores vencidas o por vencer y diferencias de conciliación.
Orden: gravedad, luego importe. Cada ítem indica motivo, importe, responsable y enlace.

Gráficos: ventas mensuales, cobros mensuales, evolución de la deuda vencida (al cierre de cada
mes, reconstruida con pagos confirmados hasta esa fecha), inventario por marca, antigüedad del
inventario y margen por operación. Sólo usan registros reales; sin datos, muestran un estado vacío.

## Cobranzas (`/cobranzas`)

| Indicador | Fórmula |
|---|---|
| Cartera pendiente | Σ saldo de contratos vigentes |
| Total vencido | Σ saldo de cuotas vencidas |
| Cartera vencida (%) | Total vencido ÷ cartera pendiente × 100 |
| Clientes en mora | Clientes distintos con al menos una cuota vencida impaga |
| Recuperado este mes | Σ pagos confirmados con fecha de cobro en el mes (sin usados ni notas de crédito) |
| Compromisos pendientes | Promesas con fecha futura no cubiertas por pagos confirmados; «incumplida» si venció sin pago suficiente |

**Días de atraso** de un contrato = días desde el vencimiento de su cuota impaga más antigua.
**Tramo de mora** según Configuración (por defecto: Al día, 1–30, 31–60, 61–90, más de 90).
Un pago registrado sin confirmar no reduce la mora; una promesa tampoco.

**Bandeja diaria** (prioridad explicable): 1) promesas incumplidas, 2) gestiones agendadas
para hoy o atrasadas, 3) mayor importe vencido en moneda base ponderado por antigüedad.

## Rentabilidad por operación

- **Margen estimado** = precio de venta (base) − costes registrados − costes estimados.
- **Margen realizado** = el mismo cálculo cuando la operación está entregada y no quedan costes
  estimados sin factura.
- **Cobrado** = pagos confirmados aplicados; **por cobrar** = saldo del contrato.
- Los descuentos por encima del máximo de Configuración requieren aprobación previa.

## Trade-in

Margen esperado = reventa esperada − valor aceptado (u ofrecido) − reparaciones estimadas.
El valor de mercado sólo se registra con fuente y fecha, y se presenta como estimación interna,
no como tasación profesional verificada.

## Reportes

Ver `/reportes`: cada reporte describe su cálculo en pantalla. El flujo de caja proyectado es
una **proyección** (cuotas pendientes por vencimiento y facturas aprobadas por vencimiento) y
muestra el vencido acumulado aparte, sin sumarlo al flujo futuro.
