# Motor Haus · Guion de presentación a la dirección

Datos: organización **Motor Haus (DEMO)**, ficticia y señalizada en todas las pantallas. Contraseña de todos los usuarios demo: `MotorHaus-Demo-2026` (configurable con `MH_DEMO_PASSWORD`).

| Usuario | Rol |
|---|---|
| direccion@motorhaus.demo | Director general |
| finanzas@motorhaus.demo | Directora financiera |
| comercial@motorhaus.demo | Gerente comercial |
| asesor1@motorhaus.demo / asesor2@motorhaus.demo | Asesores de ventas |
| cobranzas@motorhaus.demo | Responsable de cobranzas |
| inventario@motorhaus.demo | Responsable de inventario |
| importaciones@motorhaus.demo | Responsable de importaciones |
| auditor@motorhaus.demo | Auditor |
| admin@motorhaus.demo | Administrador técnico |

## Acto I — Control del capital (inventario@ o direccion@)

1. **Inventario → Ejecutivo**: ordenar por *Días*. El Mercedes 280 SL y el McLaren Artura superan el umbral de inmovilización; mostrar coste real, estimados pendientes (en ámbar) y margen potencial.
2. Abrir el 280 SL: cuatro estados separados, costes reales vs. estimados, historial de precios con motivo («Ajuste por antigüedad en stock»), conteo físico.
3. **Importaciones**: EMB-0398 (Huracán STO) demorado, ETA original vs. vigente, incidencia de aduana, costes estimados vs. reales.
4. **Preparación**: Ferrari SF90 recibido pero no disponible: faltan tareas obligatorias y documentos.

## Acto II — La realidad financiera (finanzas@)

1. **Cuentas por cobrar**: saldo, vencido, % de cartera vencida, efectividad de cobranza (con fórmulas visibles), tramos de mora configurables.
2. Bandeja diaria: Hugo Benítez (139 días de atraso), compromiso incumplido de Fernanda Costa.
3. Estado de cuenta de Náutica del Lago: pago con cheque **revertido** — aparece como pago y reversión, no cuenta como cobrado; el saldo final reconcilia con las obligaciones.
4. **Pagos recibidos**: un pago de Mariana Valdez *pendiente de conciliación* — asignado pero no cobrado. Confirmarlo (la CFO no lo registró: segregación).

## Acto III — Una negociación realista (asesor2@ y comercial@)

1. **Mesa de negociación → NEG del Rolls-Royce Cullinan**: escenarios A (francés 24 meses) y B (36 meses con refuerzos) comparados; margen de la unidad y capital financiado con su fórmula.
2. Crear un escenario C en vivo: cambiar tasa, plazo o agregar un refuerzo; la vista previa usa el mismo motor que el servidor; al guardar, PostgreSQL valida el calendario.
3. Abrir la operación del Aston Martin DB12 (asesor1@): descuento 8,6 % y margen bajo ⇒ dos autorizaciones pendientes; la tasación del BMW X5 queda pendiente por margen de reventa bajo — su margen se informa **separado** del de la venta.
4. Como comercial@, en **Aprobaciones**: el sistema registra valor límite, valor solicitado, fundamento y quién decide.

## Acto IV — Del acuerdo a la operación (asesor2@ → finanzas@ → cobranzas@)

1. Emitir la **propuesta PDF** del Cullinan: indica su estado de aprobación, que no es contrato ni aprobación de crédito, y su verificación de integridad.
2. Como finanzas@: **Formalizar** (confirmación en dos pasos). Se crean contrato, versión inmutable, entrega inicial y 24 cuotas; la unidad pasa a vendida pendiente de entrega y la reserva se convierte.
3. Como cobranzas@: **Registrar pago** de la entrega; queda pendiente de conciliación. Como finanzas@: confirmarlo; el saldo del contrato y la caja se actualizan y la acción queda auditada.

## Acto V — La visión del director (direccion@)

1. **Centro de control**: posición financiera separando caja (manual), cuentas por cobrar, cuentas por pagar, capital invertido, valor de stock y rentabilidad; el resultado operativo aparece con su base de cálculo declarada.
2. Bandeja de atención prioritaria ordenada por severidad, impacto y antigüedad; cada alerta abre su expediente.
3. Proyección contractual de caja (no es flujo realizado) y ventas vs. objetivo.
4. **Auditoría**: recorrer la formalización y la confirmación de pago por identificador de operación.

## Qué es real y qué es estimado

- *Real*: costes con factura, pagos confirmados, contratos formalizados, movimientos registrados.
- *Estimado*: costes estimados, margen potencial, valor de mercado de tasaciones, margen de reventa de trade-in, proyección de caja.
- *Manual*: saldos de caja y bancos (no hay integración bancaria).
- Ninguna cifra demo representa resultados reales; la evaluación económica requiere medir antes los costes operativos actuales.

## Argumento de valor (sin promesas no medidas)

Visibilidad del capital, inventario con estados verificables, ventas y cobranzas conectadas por obligaciones, deuda con seguimiento estructurado, descuentos y excepciones trazables, tasaciones documentadas con fuente, cálculos financieros consistentes y verificados por la base, e información ejecutiva inmediata. No se promete un porcentaje de ahorro ni de reducción de mora sin una medición de referencia; se propone medir durante 90 días: días de inmovilización, cartera vencida, tiempo de conciliación y descuentos fuera de política.
