'use client';

import React, { useState, useEffect } from 'react';
import { ParsedAssetRow } from '@/lib/csv-parser';
import { detectAsset, AssetType, Currency } from '@/lib/asset-type-detector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Check, X } from 'lucide-react';

export interface BulkEditGridProps {
  data: ParsedAssetRow[];
  onDataChange: (data: ParsedAssetRow[]) => void;
  validationErrors?: Map<number, string[]>;
}

interface ExtendedAssetRow extends ParsedAssetRow {
  asset_type?: AssetType;
  currency?: Currency;
  name?: string;
}

export function BulkEditGrid({ data, onDataChange, validationErrors }: BulkEditGridProps) {
  const [rows, setRows] = useState<ExtendedAssetRow[]>([]);

  useEffect(() => {
    const initialRows = data.map((row) => {
      const detected = detectAsset(row.symbol);
      return {
        ...row,
        asset_type: detected.assetType,
        currency: detected.currency,
      };
    });
    setRows(initialRows);
  }, [data]);

  useEffect(() => {
    onDataChange(rows);
  }, [rows, onDataChange]);

  const handleCellChange = (index: number, field: keyof ExtendedAssetRow, value: any) => {
    setRows((prevRows) => {
      const newRows = [...prevRows];
      newRows[index] = { ...newRows[index], [field]: value };

      if (field === 'symbol' && value) {
        const detected = detectAsset(value);
        newRows[index].asset_type = detected.assetType;
        newRows[index].currency = detected.currency;
      }

      return newRows;
    });
  };

  const handleAddRow = () => {
    const newRow: ExtendedAssetRow = {
      symbol: '',
      name: '',
      quantity: 0,
      average_price: 0,
      exchange_rate: undefined,
      transaction_type: undefined,
      transaction_date: undefined,
      account_name: undefined,
      asset_type: 'stock',
      currency: 'KRW',
    };
    setRows([...rows, newRow]);
  };

  const handleDeleteRow = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const hasError = (rowIndex: number) => {
    return validationErrors && validationErrors.has(rowIndex);
  };

  const getErrorBorderClass = (rowIndex: number) => {
    return hasError(rowIndex) ? 'border-red-500' : '';
  };

  return (
    <div className="space-y-4">
      {/* Add Row Button */}
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleAddRow}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          행 추가
        </Button>
      </div>

      {/* Data Grid */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-semibold w-12">번호</th>
              <th className="px-4 py-3 font-semibold min-w-[150px]">종목 코드</th>
              <th className="px-4 py-3 font-semibold min-w-[120px]">종목명</th>
              <th className="px-4 py-3 font-semibold">수량</th>
              <th className="px-4 py-3 font-semibold">평단가</th>
              <th className="px-4 py-3 font-semibold">환율</th>
              <th className="px-4 py-3 font-semibold">거래 유형</th>
              <th className="px-4 py-3 font-semibold">거래일</th>
              <th className="px-4 py-3 font-semibold">계좌명</th>
              <th className="px-4 py-3 font-semibold">자산 유형</th>
              <th className="px-4 py-3 font-semibold">통화</th>
              <th className="px-4 py-3 font-semibold w-16">상태</th>
              <th className="px-4 py-3 font-semibold w-16">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-transparent">
            {rows.map((row, index) => (
              <tr
                key={index}
                className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                  hasError(index) ? 'bg-red-50 dark:bg-red-950/20' : ''
                }`}
              >
                {/* Row Number */}
                <td className="px-4 py-3 text-zinc-400">{index + 1}</td>

                {/* Symbol */}
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={row.symbol || ''}
                    onChange={(e) => handleCellChange(index, 'symbol', e.target.value)}
                    placeholder="종목 코드"
                    className={`w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white font-semibold ${getErrorBorderClass(
                      index
                    )}`}
                  />
                </td>

                {/* Name */}
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={row.name || ''}
                    onChange={(e) => handleCellChange(index, 'name', e.target.value)}
                    placeholder="종목명"
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white"
                  />
                </td>

                {/* Quantity */}
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={row.quantity || ''}
                    onChange={(e) =>
                      handleCellChange(index, 'quantity', parseFloat(e.target.value) || 0)
                    }
                    placeholder="0"
                    min="0"
                    step="any"
                    className={`w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white ${getErrorBorderClass(
                      index
                    )}`}
                  />
                </td>

                {/* Average Price */}
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={row.average_price || ''}
                    onChange={(e) =>
                      handleCellChange(index, 'average_price', parseFloat(e.target.value) || 0)
                    }
                    placeholder="0"
                    min="0"
                    step="any"
                    className={`w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white ${getErrorBorderClass(
                      index
                    )}`}
                  />
                </td>

                {/* Exchange Rate */}
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={row.exchange_rate || ''}
                    onChange={(e) =>
                      handleCellChange(
                        index,
                        'exchange_rate',
                        e.target.value ? parseFloat(e.target.value) : undefined
                      )
                    }
                    placeholder="자동"
                    min="0"
                    step="any"
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white"
                  />
                </td>

                {/* Transaction Type */}
                <td className="px-4 py-3">
                  <select
                    value={row.transaction_type || ''}
                    onChange={(e) =>
                      handleCellChange(
                        index,
                        'transaction_type',
                        e.target.value || undefined
                      )
                    }
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white"
                  >
                    <option value="">선택</option>
                    <option value="매수">매수</option>
                    <option value="매도">매도</option>
                  </select>
                </td>

                {/* Transaction Date */}
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={row.transaction_date || ''}
                    onChange={(e) =>
                      handleCellChange(
                        index,
                        'transaction_date',
                        e.target.value || undefined
                      )
                    }
                    placeholder="YYYY-MM-DD"
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white"
                  />
                </td>

                {/* Account Name */}
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={row.account_name || ''}
                    onChange={(e) =>
                      handleCellChange(index, 'account_name', e.target.value || undefined)
                    }
                    placeholder="계좌명"
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white"
                  />
                </td>

                {/* Asset Type */}
                <td className="px-4 py-3">
                  <select
                    value={row.asset_type || 'stock'}
                    onChange={(e) =>
                      handleCellChange(index, 'asset_type', e.target.value as AssetType)
                    }
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white text-xs"
                  >
                    <option value="stock">주식</option>
                    <option value="crypto">암호화폐</option>
                    <option value="etf">ETF</option>
                  </select>
                </td>

                {/* Currency */}
                <td className="px-4 py-3">
                  <select
                    value={row.currency || 'KRW'}
                    onChange={(e) =>
                      handleCellChange(index, 'currency', e.target.value as Currency)
                    }
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white text-xs"
                  >
                    <option value="KRW">KRW</option>
                    <option value="USD">USD</option>
                    <option value="JPY">JPY</option>
                  </select>
                </td>

                {/* Status */}
                <td className="px-4 py-3 text-center">
                  {hasError(index) ? (
                    <X className="w-4 h-4 text-red-500 mx-auto" />
                  ) : row.symbol && row.quantity > 0 && row.average_price > 0 ? (
                    <Check className="w-4 h-4 text-emerald-500 mx-auto" />
                  ) : (
                    <span className="text-zinc-400">-</span>
                  )}
                </td>

                {/* Actions */}
                <td className="px-4 py-3 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteRow(index)}
                    className="h-8 w-8 text-zinc-400 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}

            {/* Empty state */}
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-zinc-400">
                  CSV 파일을 업로드하거나 &quot;행 추가&quot; 버튼을 클릭하세요
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Validation Errors Display */}
      {validationErrors && validationErrors.size > 0 && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-4">
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-2">
            검증 오류
          </h3>
          <ul className="space-y-1">
            {Array.from(validationErrors.entries()).map(([rowIndex, errors]) => (
              <li key={rowIndex} className="text-sm text-red-700 dark:text-red-300">
                행 {rowIndex + 1}: {errors.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
