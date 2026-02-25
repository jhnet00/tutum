import logging
import asyncio
import json
import uuid
from datetime import datetime
from typing import Dict, List

from ..cache import cache_get, cache_set
from ..models.notification import Notification

logger = logging.getLogger(__name__)


class MarketMonitor:
    def __init__(self):
        self.price_history: Dict[str, List[dict]] = {}
        self.notifications: List[Notification] = []
        self.cooldowns: Dict[str, datetime] = {}
        self.is_running = False
        self._state_dirty = False
        self._notifications_cache_key = "market_monitor:notifications"
        self._cooldowns_cache_key = "market_monitor:cooldowns"

        # Alert threshold (default 3%)
        self.THRESHOLD = 0.03

        # Target markets to monitor
        self.TARGET_COINS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL"]

    async def start_monitoring(self):
        """Start market monitoring loop."""
        self.is_running = True
        logger.info("Market Monitor started")
        await self._load_state()

        from .market_data import crypto_client

        while self.is_running:
            try:
                current_prices = {}
                for ticker in self.TARGET_COINS:
                    try:
                        data = await crypto_client.get_current_price(ticker)
                        current_prices[ticker] = data["price"]
                    except Exception as e:
                        logger.warning("Failed to fetch price for {ticker}: %s", e)

                self._check_price_drops(current_prices)

                if self._state_dirty:
                    await self._persist_state()
                    self._state_dirty = False

            except Exception as e:
                logger.error("Market Monitor Loop Error: %s", e)

            await asyncio.sleep(60)

    async def _load_state(self):
        """Load notifications and cooldowns from Redis cache."""
        try:
            notifications_raw = await cache_get(self._notifications_cache_key)
            if notifications_raw:
                items = json.loads(notifications_raw)
                self.notifications = [Notification(**item) for item in items]

            cooldowns_raw = await cache_get(self._cooldowns_cache_key)
            if cooldowns_raw:
                cooldowns = json.loads(cooldowns_raw)
                self.cooldowns = {
                    key: datetime.fromisoformat(value)
                    for key, value in cooldowns.items()
                }
        except Exception:
            # Keep monitor running even if cache payload is malformed.
            self.notifications = []
            self.cooldowns = {}

    async def _persist_state(self):
        """Persist notifications and cooldown state into Redis."""
        try:
            notifications_payload = json.dumps(
                [n.model_dump(mode="json") for n in self.notifications],
                ensure_ascii=False,
            )
            cooldowns_payload = json.dumps(
                {k: v.isoformat() for k, v in self.cooldowns.items()},
                ensure_ascii=False,
            )
            await cache_set(self._notifications_cache_key, notifications_payload, expire_seconds=86400)
            await cache_set(self._cooldowns_cache_key, cooldowns_payload, expire_seconds=86400)
        except Exception:
            # Ignore cache write failures and keep the monitor alive.
            pass

    def _check_price_drops(self, current_prices: Dict[str, float]):
        """Detect sudden price changes."""
        now = datetime.now()

        for ticker, current_price in current_prices.items():
            if ticker not in self.price_history:
                self.price_history[ticker] = []

            self.price_history[ticker].append({"price": current_price, "time": now})

            # Keep only the latest 10 minutes window.
            self.price_history[ticker] = [
                p for p in self.price_history[ticker]
                if (now - p["time"]).total_seconds() < 600
            ]

            # Find approximately 5 minutes ago baseline.
            five_min_ago_price = None
            for p in self.price_history[ticker]:
                age = (now - p["time"]).total_seconds()
                if 270 <= age <= 330:
                    five_min_ago_price = p["price"]
                    break

            if not five_min_ago_price:
                continue

            change_rate = (current_price - five_min_ago_price) / five_min_ago_price

            if change_rate < -self.THRESHOLD:
                self._create_notification(
                    type="PRICE_DROP",
                    title=f"{ticker.replace('KRW-', '')} 급락 주의",
                    message=f"{ticker.replace('KRW-', '')} 가격이 5분 대비 {abs(change_rate)*100:.1f}% 하락했습니다.",
                )
            elif change_rate > self.THRESHOLD:
                self._create_notification(
                    type="PRICE_SURGE",
                    title=f"{ticker.replace('KRW-', '')} 급등 알림",
                    message=f"{ticker.replace('KRW-', '')} 가격이 5분 대비 {change_rate*100:.1f}% 상승했습니다.",
                )

    def _create_notification(self, type: str, title: str, message: str):
        """Create notification with cooldown handling."""
        now = datetime.now()

        cooldown_key = f"{title}:{type}"
        last_alert = self.cooldowns.get(cooldown_key)

        if last_alert and (now - last_alert).total_seconds() < 600:
            return

        notification = Notification(
            id=str(uuid.uuid4()),
            type=type,
            title=title,
            message=message,
            created_at=now,
            is_read=False,
        )

        self.notifications.insert(0, notification)
        if len(self.notifications) > 100:
            self.notifications.pop()

        self.cooldowns[cooldown_key] = now
        self._state_dirty = True

        logger.info("New notification created: %s", title)

    def get_notifications(self, limit: int = 20, unread_only: bool = False):
        """List notifications."""
        results = self.notifications
        if unread_only:
            results = [n for n in results if not n.is_read]
        return results[:limit]

