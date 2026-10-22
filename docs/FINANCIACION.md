# Motor de financiación

Implementación: `src/domain/financing/` (pura, con pruebas en `tests/unit/financing.test.ts`).
El mismo motor alimenta el simulador, el constructor de operaciones, la propuesta PDF y el
cronograma definitivo que se genera al formalizar.

## Modalidades

- **Contado**: sin cronograma de cuotas; la operación queda saldada con los pagos confirmados.
- **Financiado**: entrega inicial + usado tomado (trade-in) + capital financiado en cuotas
  mensuales, con refuerzos opcionales.

Capital financiado = precio de venta − entrega inicial − valor aceptado del usado.

## Convenciones de tasa

La tasa se ingresa en porcentaje y se interpreta según la convención elegida (por defecto, la
de Configuración):

| Convención | Tasa mensual efectiva (TEM) |
|---|---|
| TNA — nominal anual | TNA ÷ 12 |
| TEA — efectiva anual | (1 + TEA)^(1/12) − 1 |
| TEM — efectiva mensual | TEM |

Todas las cuotas se calculan con la TEM resultante y la interfaz informa las tres expresiones
equivalentes. Tasa 0 % es válida (sin intereses). Una tasa vacía es un error: no se asume 0 %.

## Sistemas de amortización

- **Francés** (cuota constante): `C = (P − Σ Rₖ/(1+i)^mₖ) · i / (1 − (1+i)^−n)`, donde Rₖ son
  los refuerzos en la cuota mₖ. Con tasa 0: `C = (P − ΣR) / n`.
- **Alemán** (capital constante): capital por cuota `(P − ΣR) / n`; interés sobre el saldo.

Los refuerzos son filas propias del cronograma (tipo «refuerzo», sin interés: el interés del
período ya está en la cuota regular de esa fecha).

## Redondeo

- Importes en unidades mínimas: PYG sin decimales, USD con 2 decimales.
- Interés de cada período = saldo anterior × TEM, redondeado mitad hacia arriba.
- El saldo se arrastra con importes ya redondeados.
- La última cuota absorbe la diferencia de redondeo: la suma del capital de las cuotas es
  exactamente el capital financiado.
- Vencimientos mensuales desde el primer vencimiento conservando el día (31 → último día del mes).

## Monedas

Cada contrato tiene una moneda (PYG o USD) y todos sus importes están en ella. Un pago en otra
moneda se convierte al tipo de cambio registrado del día del cobro (`exchange_rates`), que
queda guardado en el pago; si no hay tipo de cambio cargado, el pago se rechaza. Los
indicadores en moneda base convierten los saldos en USD con el último tipo de cambio y lo
indican como referencial.

## Pagos y aplicación

1. **Registrar** un pago no cambia ningún saldo (estado «registrado»).
2. **Confirmar** (otro permiso) crea el movimiento de caja y aplica el importe a las cuotas
   pendientes **de la más antigua a la más reciente**; un pago puede cubrir varias cuotas y una
   cuota recibir varios pagos (`payment_allocations`). Un excedente queda como saldo a favor.
3. **Revertir** un pago confirmado crea un contraasiento de caja, aplicaciones negativas y un
   asiento en el mayor; el pago original se conserva con estado «revertido».
4. Se avisa de posibles duplicados (misma cuenta, fecha, importe y referencia) y se exige
   confirmación explícita para registrarlo igualmente.

Las promesas de pago son gestiones de cobranza: nunca se cuentan como dinero recibido.

## Cancelación anticipada (`payoff.ts`)

Importe = saldo de las cuotas vencidas (completas) + capital pendiente de las no vencidas.
Los intereses no devengados se condonan mediante una nota de crédito, que requiere aprobación.
Si una cuota no vencida tiene un pago parcial, se considera que cubrió primero su interés.

## Refinanciación

Requiere aprobación (`contracts.approve`). Cancela el saldo de las cuotas vigentes, genera un
nuevo plan con las nuevas condiciones y una nueva versión del contrato; el historial completo
queda en `contract_versions` y en el mayor.

## Simulación y propuesta

La simulación no crea contratos ni modifica el inventario. La propuesta PDF lleva número único,
fecha de validez (Configuración), logo, cliente, unidad, precio, descuento, entrega, usado,
financiación y tabla de pagos, con la leyenda: *«Esta propuesta es una cotización válida hasta
la fecha indicada y no constituye una aprobación crediticia ni una reserva de la unidad»*. Se descarga o se comparte por WhatsApp desde la operación.
