/**
 * Market Data Fetcher Script
 * 
 * Binance API (Crypto) + Yahoo Finance (Stocks)에서 1주일 가격 히스토리를 가져와
 * JSON Mock 파일로 저장합니다.
 * 
 * 실행: npx ts-node scripts/fetch-market-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface AssetData {
    name: string;
    symbol: string;
    price: number;
    change: number;
    market?: string;
    history: number[];
}

interface WatchlistData {
    updatedAt: string;
    assets: Record<string, AssetData>;
}

// Binance API로 코인 데이터 가져오기
async function fetchBinanceData(symbol: string, name: string): Promise<AssetData> {
    const pair = `${symbol}USDT`;

    // 1주일 일봉 데이터 (7일)
    const klineUrl = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=7`;
    const tickerUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;

    try {
        const [klineRes, tickerRes] = await Promise.all([
            fetch(klineUrl),
            fetch(tickerUrl)
        ]);

        const klineData = await klineRes.json();
        const tickerData = await tickerRes.json();

        // 종가(close price) 배열 추출
        const history = klineData.map((k: any[]) => parseFloat(k[4]));
        const price = parseFloat(tickerData.lastPrice);
        const change = parseFloat(tickerData.priceChangePercent);

        return {
            name,
            symbol,
            price,
            change,
            history
        };
    } catch (error) {
        console.error(`Error fetching ${symbol}:`, error);
        throw error;
    }
}

// Yahoo Finance API로 주식 데이터 가져오기
async function fetchYahooData(symbol: string, name: string, market: string): Promise<AssetData> {
    // Yahoo Finance API (chart endpoint)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=7d`;

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const data = await res.json();
        const result = data.chart.result[0];
        const meta = result.meta;
        const quotes = result.indicators.quote[0];

        // 종가 배열
        const history = quotes.close.filter((p: number | null) => p !== null);
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const change = ((price - prevClose) / prevClose) * 100;

        return {
            name,
            symbol: symbol.replace('.KS', ''),
            price,
            change,
            market,
            history
        };
    } catch (error) {
        console.error(`Error fetching ${symbol}:`, error);
        throw error;
    }
}

async function main() {
    console.log('🚀 Fetching market data...\n');

    // 코인 목록
    const cryptoList = [
        { symbol: 'BTC', name: 'Bitcoin' },
        { symbol: 'ETH', name: 'Ethereum' },
        { symbol: 'SOL', name: 'Solana' },
        { symbol: 'ADA', name: 'Cardano' },
    ];

    // 주식 목록
    const stockList = [
        { symbol: 'AAPL', name: 'Apple Inc.', market: 'US' },
        { symbol: 'TSLA', name: 'Tesla Inc.', market: 'US' },
        { symbol: 'NVDA', name: 'NVIDIA Corp.', market: 'US' },
        { symbol: '005930.KS', name: '삼성전자', market: 'KR' },
        { symbol: '000660.KS', name: 'SK하이닉스', market: 'KR' },
    ];

    // 코인 데이터 Fetch
    console.log('📈 Fetching crypto data from Binance...');
    const cryptoAssets: Record<string, AssetData> = {};

    for (const coin of cryptoList) {
        try {
            const data = await fetchBinanceData(coin.symbol, coin.name);
            cryptoAssets[coin.symbol] = data;
            console.log(`  ✓ ${coin.symbol}: $${data.price.toLocaleString()} (${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%)`);
        } catch {
            console.log(`  ✗ ${coin.symbol}: Failed to fetch`);
        }
    }

    // 주식 데이터 Fetch
    console.log('\n📊 Fetching stock data from Yahoo Finance...');
    const stockAssets: Record<string, AssetData> = {};

    for (const stock of stockList) {
        try {
            const data = await fetchYahooData(stock.symbol, stock.name, stock.market);
            stockAssets[data.symbol] = data;
            const priceStr = stock.market === 'KR' ? `₩${data.price.toLocaleString()}` : `$${data.price.toFixed(2)}`;
            console.log(`  ✓ ${data.symbol}: ${priceStr} (${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%)`);
        } catch {
            console.log(`  ✗ ${stock.symbol}: Failed to fetch`);
        }
    }

    // JSON 파일 저장
    const outputDir = path.join(process.cwd(), 'public', 'data');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const cryptoData: WatchlistData = {
        updatedAt: new Date().toISOString(),
        assets: cryptoAssets
    };

    const stockData: WatchlistData = {
        updatedAt: new Date().toISOString(),
        assets: stockAssets
    };

    fs.writeFileSync(
        path.join(outputDir, 'watchlist-crypto.json'),
        JSON.stringify(cryptoData, null, 2)
    );

    fs.writeFileSync(
        path.join(outputDir, 'watchlist-stocks.json'),
        JSON.stringify(stockData, null, 2)
    );

    console.log('\n✅ Data saved to public/data/');
    console.log('   - watchlist-crypto.json');
    console.log('   - watchlist-stocks.json');
}

main().catch(console.error);
