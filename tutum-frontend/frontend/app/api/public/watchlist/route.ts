import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export async function GET() {
    try {
        const dataDir = path.join(process.cwd(), "public", "data");

        // Read both files
        const [cryptoData, stockData] = await Promise.all([
            fs.readFile(path.join(dataDir, "watchlist-crypto.json"), "utf8"),
            fs.readFile(path.join(dataDir, "watchlist-stocks.json"), "utf8"),
        ]);

        const crypto = JSON.parse(cryptoData);
        const stocks = JSON.parse(stockData);

        return NextResponse.json({
            updatedAt: new Date().toISOString(),
            crypto: Object.values(crypto.assets),
            stocks: Object.values(stocks.assets),
        });
    } catch (error) {
        console.error("Error reading watchlist data:", error);
        return NextResponse.json(
            { error: "Failed to fetch watchlist data" },
            { status: 500 }
        );
    }
}
