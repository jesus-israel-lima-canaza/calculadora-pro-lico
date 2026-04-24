/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  PURCHASE_MULTIPLIERS, 
  PurchaseType, 
  ILA_RATES, 
  TaxCategory, 
  IVA_RATE, 
  COMMISSIONS,
  CalculationResult,
  PurchaseValueType,
  RoundingMode
} from './types';

/**
 * Realiza el cálculo modular de costos, impuestos y precios de venta.
 */
export function calculateLiquorMetrics(
  netInvoiceValue: number,
  purchaseType: PurchaseType,
  taxCategory: TaxCategory,
  marginPercent: number,
  valueType: PurchaseValueType = PurchaseValueType.NET,
  commissions: { debit: number; credit: number; delivery: number; packagingCost?: number }
): CalculationResult {
  const unitsPerPurchase = PURCHASE_MULTIPLIERS[purchaseType];
  const unitFactor = netInvoiceValue / (unitsPerPurchase || 1);
  
  let unitNet: number;
  let ivaAmount: number;
  let ilaAmount: number;
  let totalCost: number;

  const ilaRate = ILA_RATES[taxCategory];

  if (valueType === PurchaseValueType.GROSS) {
    // Si el valor ingresado es BRUTO (ya tiene impuestos)
    totalCost = unitFactor;
    // Desglose (aproximado): Bruto = Neto * (1 + IVA + ILA)
    unitNet = totalCost / (1 + IVA_RATE + ilaRate);
    ivaAmount = unitNet * IVA_RATE;
    ilaAmount = unitNet * ilaRate;
  } else {
    // Si el valor ingresado es NETO (valor factura sin impuestos)
    unitNet = unitFactor;
    ivaAmount = unitNet * IVA_RATE;
    ilaAmount = unitNet * ilaRate;
    totalCost = unitNet + ivaAmount + ilaAmount;
  }
  
  // 4. Precio de Mostrador (Margen sobre costo total)
  const marginMultiplier = 1 + (marginPercent / 100);
  const counterPrice = totalCost * marginMultiplier;
  
  // 5. Abonos Reales (Neto recibido si se vende al precio de mostrador)
  const debitPrice = counterPrice * (1 - (commissions.debit / 100));
  const creditPrice = counterPrice * (1 - (commissions.credit / 100));
  
  // Incluimos el costo de bolsas/empaques en el precio de delivery antes de aplicar la protección de comisión
  const pkgCost = commissions.packagingCost || 0;
  const pedidosYaPrice = (counterPrice + pkgCost) / (1 - (commissions.delivery / 100));
  
  // 6. Ganancia Neta por unidad
  const netProfitUnit = Math.max(0, counterPrice - totalCost);
  
  // 7. Ganancia Neta por caja (basado en la compra original)
  const netProfitBox = netProfitUnit * unitsPerPurchase;

  // 8. Punto de Equilibrio (Unidades a vender para recuperar costo de caja)
  const boxTotalCost = totalCost * unitsPerPurchase;
  const breakEvenUnits = counterPrice > 0 ? boxTotalCost / counterPrice : 0;

  // 9. Precios por Packs (basados en el counterPrice unitario)
  const packPrices = {
    pack4: counterPrice * 4,
    pack6: counterPrice * 6,
    box12: counterPrice * 12,
    box24: counterPrice * 24,
  };
  
  return {
    unitNet,
    ivaAmount,
    ilaAmount,
    totalCost,
    counterPrice,
    debitPrice,
    creditPrice,
    pedidosYaPrice,
    netProfitUnit,
    netProfitBox,
    breakEvenUnits,
    packPrices
  };
}

/**
 * Formatea un número como moneda CLP.
 */
export const formatCLP = (value: number) => {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(value);
};

/**
 * Redondeo inteligente según el modo configurado.
 */
export const smartRound = (value: number, mode: RoundingMode = RoundingMode.NORMAL) => {
  if (value === 0) return 0;

  switch (mode) {
    case RoundingMode.ENDS_90: {
      // Caso 4196 -> Queremos terminar en 90 sin perder.
      // 4190 es menor que 4196, así que saltamos a 4290.
      const base = Math.floor(value / 100) * 100 + 90;
      return base < value ? base + 100 : base;
    }
    case RoundingMode.ENDS_00: {
      // Caso 4196 -> 4200
      return Math.ceil(value / 100) * 100;
    }
    case RoundingMode.NORMAL:
    default:
      // Redondeo a la decena superior
      return Math.ceil(value / 10) * 10;
  }
};
