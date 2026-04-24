/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum PurchaseType {
  UNIT = 'Unidad',
  PACK_4 = 'Pack x4',
  PACK_6 = 'Pack x6',
  BOX_12 = 'Caja x12',
  BOX_24 = 'Caja x24'
}

export const PURCHASE_MULTIPLIERS = {
  [PurchaseType.UNIT]: 1,
  [PurchaseType.PACK_4]: 4,
  [PurchaseType.PACK_6]: 6,
  [PurchaseType.BOX_12]: 12,
  [PurchaseType.BOX_24]: 24,
};

export enum PurchaseValueType {
  NET = 'Neto (Sin Impuestos)',
  GROSS = 'Bruto (Pagaré Final)',
}

export enum RoundingMode {
  NORMAL = 'Estándar (Decena)',
  ENDS_90 = 'Terminado en 90',
  ENDS_00 = 'Terminado en 00',
}

export enum TaxCategory {
  DESTILADOS = 'Destilados (31.5%)',
  CERVEZA_VINO = 'Vinos/Cervezas (20.5%)',
  ANALCOHOLICA_AZUCAR = 'Analcohólica >15g (18%)',
  ANALCOHOLICA_LIGHT = 'Analcohólica <=15g (10%)',
  NONE = 'Sin ILA (0%)'
}

export const ILA_RATES = {
  [TaxCategory.DESTILADOS]: 0.315,
  [TaxCategory.CERVEZA_VINO]: 0.205,
  [TaxCategory.ANALCOHOLICA_AZUCAR]: 0.18,
  [TaxCategory.ANALCOHOLICA_LIGHT]: 0.1,
  [TaxCategory.NONE]: 0,
};

export const IVA_RATE = 0.19;

export const COMMISSIONS = {
  DEBIT: 0.015,
  CREDIT: 0.03,
  PEDIDOS_YA: 0.25
};

export interface ProductIdentity {
  name: string;
  description: string;
  supplier: string;
  volume: string;
  origin: string;
  alcoholGrade: string;
  barcode: string;
}

export interface CommissionStructure {
  debit: number;
  credit: number;
  delivery: number;
  deliveryName: string;
  packagingCost: number;
}

export interface CalculationResult {
  unitNet: number;
  ivaAmount: number;
  ilaAmount: number;
  totalCost: number;
  counterPrice: number;
  debitPrice: number;
  creditPrice: number;
  pedidosYaPrice: number;
  netProfitUnit: number;
  netProfitBox: number;
  breakEvenUnits: number;
  packPrices: {
    pack4: number;
    pack6: number;
    box12: number;
    box24: number;
  };
}
