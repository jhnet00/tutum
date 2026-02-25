"""
============================================
Price Consumer - 시세 데이터 Redis 캐싱
============================================

Kafka 'prices' 토픽에서 시세 데이터를 수신하여
Redis에 캐싱합니다.

운영 환경: Node3에서 실행
토픽: prices
Producer: Price Producer (외부 API -> Kafka)

캐시 구조:
- price:{symbol} -> 현재가 데이터 (TTL: 30초)
"""

import asyncio
import json
import os
from datetime import datetime

from aiokafka import AIOKafkaConsumer
import redis.asyncio as redis

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
TOPIC = "prices"
GROUP_ID = "price-consumer-group"
PRICE_TTL_SECONDS = 30


class PriceConsumer:
    """시세 데이터 Consumer"""

    def __init__(self):
        self.consumer = None
        self.redis_client = None
        self.running = False

    async def connect(self):
        """Kafka 및 Redis 연결"""
        # Kafka Consumer 초기화
        self.consumer = AIOKafkaConsumer(
            TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            group_id=GROUP_ID,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
            auto_offset_reset="latest",
        )
        await self.consumer.start()
        print(f"[OK] Kafka Consumer 연결 성공: {TOPIC}")

        # Redis 연결
        try:
            self.redis_client = redis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True
            )
            await self.redis_client.ping()
            print(f"[OK] Redis 연결 성공: {REDIS_URL}")
        except Exception as e:
            print(f"[WARNING] Redis 연결 실패: {e}")
            self.redis_client = None

    async def cache_price(self, price_data: dict):
        """Redis에 시세 캐싱"""
        if self.redis_client is None:
            return

        try:
            symbol = price_data.get("symbol")
            if not symbol:
                return

            key = f"price:{symbol}"
            value = json.dumps({
                "symbol": symbol,
                "price": price_data.get("price"),
                "asset_type": price_data.get("asset_type"),
                "currency": price_data.get("currency", "USD"),
                "timestamp": price_data.get("timestamp"),
                "cached_at": datetime.utcnow().isoformat()
            })

            await self.redis_client.setex(key, PRICE_TTL_SECONDS, value)
            print(f"[CACHE] {symbol} = {price_data.get('price')}")

        except Exception as e:
            print(f"[ERROR] Redis 캐싱 실패: {e}")

    async def run(self):
        """메인 소비 루프"""
        self.running = True
        print("[START] Price Consumer 시작")

        try:
            async for message in self.consumer:
                if not self.running:
                    break

                price_data = message.value
                await self.cache_price(price_data)

        except Exception as e:
            print(f"[ERROR] Consumer 오류: {e}")
        finally:
            await self.stop()

    async def stop(self):
        """연결 종료"""
        self.running = False

        if self.consumer:
            await self.consumer.stop()
            print("[OK] Kafka Consumer 종료")

        if self.redis_client:
            await self.redis_client.close()
            print("[OK] Redis 연결 종료")


async def main():
    """메인 실행"""
    consumer = PriceConsumer()

    try:
        await consumer.connect()
        await consumer.run()
    except KeyboardInterrupt:
        print("[INFO] 종료 요청 수신")
    finally:
        await consumer.stop()


if __name__ == "__main__":
    asyncio.run(main())
