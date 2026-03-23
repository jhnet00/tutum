import * as Papa from 'papaparse';

export interface ParsedAssetRow {
  symbol: string;
  name?: string;
  quantity: number;
  average_price: number;
  exchange_rate?: number;
  transaction_type?: string;
  transaction_date?: string;
  account_name?: string;
}

export async function parseCSV(file: File): Promise<ParsedAssetRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      encoding: 'UTF-8',
      skipEmptyLines: 'greedy',
      complete: (results) => {
        try {
          const rows = results.data as string[][];
          
          const GUIDE_ROWS_COUNT = 5;
          const HEADER_ROW_INDEX = 5;
          const MIN_REQUIRED_ROWS = 6;
          
          if (rows.length < MIN_REQUIRED_ROWS) {
            reject(new Error('CSV file is too short. Expected at least 6 rows.'));
            return;
          }

          const headerRow = rows[HEADER_ROW_INDEX];
          const dataRows = rows.slice(HEADER_ROW_INDEX + 1);

          const getColumnIndex = (headerName: string): number => {
            return headerRow.findIndex(h => h?.trim() === headerName);
          };

          const symbolIndex = getColumnIndex('종목명/종목 코드');
          const quantityIndex = getColumnIndex('수량');
          const avgPriceIndex = getColumnIndex('평단가');
          const exchangeRateIndex = getColumnIndex('환율');
          const transactionTypeIndex = getColumnIndex('거래 유형');
          const transactionDateIndex = getColumnIndex('거래일');
          const accountNameIndex = getColumnIndex('계좌명');

          if (symbolIndex === -1 || quantityIndex === -1 || avgPriceIndex === -1) {
            reject(new Error('Required headers not found: 종목명/종목 코드, 수량, 평단가'));
            return;
          }

          const parseNumberWithCommas = (value: string | undefined): number => {
            if (!value || value.trim() === '') return 0;
            const cleaned = value.replace(/,/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? 0 : parsed;
          };

          const parsedRows: ParsedAssetRow[] = dataRows
            .filter(row => row.length > 1 && row[symbolIndex]?.trim())
            .map(row => {
              const symbol = row[symbolIndex]?.trim() || '';
              const quantity = parseNumberWithCommas(row[quantityIndex]);
              const average_price = parseNumberWithCommas(row[avgPriceIndex]);
              
              const result: ParsedAssetRow = {
                symbol,
                quantity,
                average_price,
              };

              if (exchangeRateIndex !== -1 && row[exchangeRateIndex]?.trim()) {
                result.exchange_rate = parseNumberWithCommas(row[exchangeRateIndex]);
              }
              
              if (transactionTypeIndex !== -1 && row[transactionTypeIndex]?.trim()) {
                result.transaction_type = row[transactionTypeIndex].trim();
              }
              
              if (transactionDateIndex !== -1 && row[transactionDateIndex]?.trim()) {
                result.transaction_date = row[transactionDateIndex].trim();
              }
              
              if (accountNameIndex !== -1 && row[accountNameIndex]?.trim()) {
                result.account_name = row[accountNameIndex].trim();
              }

              return result;
            })
            .filter(row => row.symbol && row.quantity > 0 && row.average_price > 0);

          resolve(parsedRows);
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}
