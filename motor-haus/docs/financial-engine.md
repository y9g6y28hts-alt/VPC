# Motor Haus · Motor financiero

Código: `src/domain/finance/engine.ts` (versión `mh-fin-1.0.0`). Validación independiente en PostgreSQL: `app.validate_schedule()` (migración 0013).

## Capital financiado

```
Capital financiado = precio negociado
                   + cargos financiados (solo si se cargan explícitamente, con concepto)
                   − (valor aceptado del trade-in − cancelación de prenda asumida)
                   − entrega en efectivo
                   − otros créditos iniciales (con concepto)
```

Se calcula en el servidor (`app.deal_economics`) y el motor recibe ese valor; un capital negativo se rechaza. Los gastos o deudas no se descuentan sin una regla explícita.

## Tasas

| Tipo | Tasa del período de *m* meses |
|---|---|
| Efectiva anual (TEA) | `i = (1 + TEA)^(m/12) − 1` → mensual: `(1 + TEA)^(1/12) − 1` |
| Nominal anual (TNA, capitalización mensual) | `i = (1 + TNA/12)^m − 1` |
| Efectiva mensual | `i = (1 + i_m)^m − 1` |
| Sin interés | `i = 0` |

Una TNA **no** se convierte como una TEA (prueba unitaria). La tasa del período se redondea a 12 decimales.

## Sistemas

- **Francés:** cuota nivelada. Sin refuerzos ni período irregular coincide con `C = P·i(1+i)^n / ((1+i)^n − 1)`; con `i = 0`, `C = P/n`. En general se calcula por valor presente: `C = (P − Σ R_k·D_k) / Σ D_k`, con `D_k = Π_{j≤k} 1/(1+i_j)`, lo que admite refuerzos y primer período irregular.
- **Alemán:** amortización constante `A = (P − Σ refuerzos)/n`; interés sobre el saldo de cada período.
- **Sin interés:** francés con tasa cero.
- **Personalizado:** amortización por período definida por el usuario (debe sumar el capital); siempre requiere autorización.

## Calendario

- Vencimientos: `primer vencimiento + (k − 1)·m meses`, con recorte a fin de mes (idéntico a `date + interval` de PostgreSQL).
- Primer período irregular: `f = días(inicio → primer vencimiento) / días(inicio → inicio + m meses)` (10 decimales); tasa `(1 + i)^f − 1`.
- Interés de cada período: `round(saldo inicial × tasa del período)` en las unidades menores de la moneda (USD 2, PYG 0 decimales; redondeo *half-up*, igual a `round()` de PostgreSQL).
- Amortización: cuota − interés (+ refuerzo). La última cuota amortiza el saldo remanente: el ajuste de redondeo es explícito (`lastInstallmentAdjustment`).
- Se rechaza la amortización negativa (cuota que no cubre intereses) y los refuerzos que igualan o superan el capital.
- Refuerzos: pago adicional en el vencimiento de un período; al formalizar se emiten como obligaciones separadas (`kind = 'balloon'`).
- Entregas iniciales variables: tramos con fecha y monto cuya suma debe igualar la entrega en efectivo; generan obligaciones `down_payment` sin interés.

## Pagos extraordinarios

`applyPrepayment(plan, período, importe, modo)` devuelve un nuevo plan desde el vencimiento indicado:

- `reduce_installment`: mantiene el plazo remanente y recalcula la cuota.
- `reduce_term`: mantiene una cuota no mayor a la original y busca el menor plazo.

El nuevo plan debe formalizarse como una nueva versión contractual (la interfaz para reprogramar contratos está pendiente; el motor está probado).

## Validación en el servidor

Antes de guardar un escenario y otra vez al formalizar, PostgreSQL verifica: moneda, capital igual al de la operación, suma de entregas, tasa periódica coherente con la tasa declarada, fracción del primer período, fechas, `saldo inicial(k) = saldo final(k−1)`, `interés = round(saldo × tasa)`, `cuota = interés + amortización`, sin amortización negativa, cuotas niveladas (francés) o amortización constante (alemán), saldo final cero y totales del resumen. Cada versión guarda entradas, resumen, calendario, versión del motor y un checksum SHA-256; el contrato conserva la referencia.

## Monedas

Cada obligación conserva su moneda contractual. No hay conversión silenciosa: costes, pagos a proveedores o pagos en otra moneda exigen cotización, fecha y fuente registradas.
