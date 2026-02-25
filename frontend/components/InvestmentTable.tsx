import { type HoldingAsset } from "@/lib/mock-data";

interface InvestmentTableProps {
  holdings: HoldingAsset[];
}

export default function InvestmentTable({ holdings }: InvestmentTableProps) {
  const formatCurrency = (value: number) => {
    return value.toLocaleString();
  };

  const calculateProfit = (holding: HoldingAsset) => {
    const currentValue = holding.currentPrice * holding.amount;
    const investedValue = holding.averagePrice * holding.amount;
    const profit = currentValue - investedValue;
    const profitPercent = ((profit / investedValue) * 100);
    return { profit, profitPercent, currentValue };
  };

  return (
    <div className="rounded-xl bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 p-4">
        <h2 className="text-lg font-semibold text-white">투자</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800 text-left text-sm text-gray-400">
              <th className="px-4 py-3 font-medium">종목/종류</th>
              <th className="px-4 py-3 font-medium">평균가</th>
              <th className="px-4 py-3 font-medium">보유량</th>
              <th className="px-4 py-3 font-medium">평단</th>
              <th className="px-4 py-3 font-medium">현재 시세</th>
              <th className="px-4 py-3 font-medium">일간 수익</th>
              <th className="px-4 py-3 font-medium">총 수익</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => {
              const { profit, profitPercent, currentValue } = calculateProfit(holding);
              // 실제 데이터의 change 값 사용 (일간 변동)
              const dailyProfit = holding.change * holding.amount;
              const dailyProfitPercent = holding.changePercent;

              return (
                <tr key={holding.symbol} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-4">
                    <div>
                      <div className="font-semibold text-white">{holding.symbol}</div>
                      <div className="text-xs text-gray-400">{holding.name}</div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-white">
                    {formatCurrency(currentValue)}
                  </td>
                  <td className="px-4 py-4 text-white">{holding.amount}</td>
                  <td className="px-4 py-4 text-white">
                    {formatCurrency(holding.averagePrice)}
                  </td>
                  <td className="px-4 py-4 text-white">
                    {formatCurrency(holding.currentPrice)}
                  </td>
                  <td className="px-4 py-4">
                    <div
                      className={`${dailyProfit >= 0 ? "text-profit" : "text-loss"
                        }`}
                    >
                      <div>
                        {dailyProfit >= 0 ? "+" : ""}
                        {formatCurrency(Math.round(dailyProfit))}
                      </div>
                      <div className="text-xs">
                        {dailyProfitPercent >= 0 ? "+" : ""}
                        {dailyProfitPercent.toFixed(2)}%
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div
                      className={`${profit >= 0 ? "text-profit" : "text-loss"
                        }`}
                    >
                      <div>
                        {profit >= 0 ? "+" : ""}
                        {formatCurrency(Math.round(profit))}
                      </div>
                      <div className="text-xs">
                        {profit >= 0 ? "+" : ""}
                        {profitPercent.toFixed(2)}%
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {holdings.length === 0 && (
        <div className="py-12 text-center text-gray-500">
          등록된 투자가 없습니다
        </div>
      )}
    </div>
  );
}
