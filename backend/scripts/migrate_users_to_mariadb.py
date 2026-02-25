"""
MongoDB → MariaDB 회원 데이터 마이그레이션 스크립트

사용법:
    cd backend
    python -m scripts.migrate_users_to_mariadb
"""

import asyncio
import sys
from pathlib import Path

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.motor_asyncio import AsyncIOMotorClient
from app.config import get_settings
from app.mariadb import connect_to_mariadb, close_mariadb_connection, create_user, get_user_by_email

settings = get_settings()


async def migrate():
    print("=" * 50)
    print("MongoDB → MariaDB 회원 마이그레이션 시작")
    print("=" * 50)

    # 1. MongoDB 연결
    mongo_client = AsyncIOMotorClient(settings.MONGODB_URL, serverSelectionTimeoutMS=5000)
    try:
        await mongo_client.admin.command("ping")
        print(f"[OK] MongoDB 연결: {settings.MONGODB_URL}")
    except Exception as e:
        print(f"[FAIL] MongoDB 연결 실패: {e}")
        return

    mongo_db = mongo_client[settings.MONGODB_DB_NAME]
    users_collection = mongo_db["users"]

    # 2. MariaDB 연결
    await connect_to_mariadb()

    # 3. MongoDB 사용자 조회
    mongo_users = await users_collection.find().to_list(length=None)
    print(f"\n[INFO] MongoDB 사용자 수: {len(mongo_users)}")

    if not mongo_users:
        print("[INFO] 마이그레이션할 사용자가 없습니다.")
        return

    # 4. 마이그레이션 실행
    success = 0
    skipped = 0
    failed = 0
    id_mapping = {}  # ObjectId → MariaDB ID

    for user in mongo_users:
        email = user.get("email", "")
        try:
            # 이미 마이그레이션된 사용자 스킵
            existing = await get_user_by_email(email)
            if existing:
                print(f"  [SKIP] {email} (이미 존재)")
                skipped += 1
                id_mapping[str(user["_id"])] = existing.id
                continue

            # MariaDB에 사용자 생성
            password = user.get("password", None)
            if password == "":
                password = None

            new_user = await create_user(
                email=email,
                password=password,
                nickname=user.get("nickname", "Unknown"),
                marketing_opt_in=user.get("marketing_opt_in", False),
                login_type=user.get("login_type", "email"),
            )

            id_mapping[str(user["_id"])] = new_user.id
            print(f"  [OK] {email} (ObjectId: {user['_id']} → MariaDB ID: {new_user.id})")
            success += 1

        except Exception as e:
            print(f"  [FAIL] {email}: {e}")
            failed += 1

    # 5. 결과 출력
    print("\n" + "=" * 50)
    print("마이그레이션 결과")
    print("=" * 50)
    print(f"  성공: {success}")
    print(f"  스킵: {skipped}")
    print(f"  실패: {failed}")
    print(f"  합계: {success + skipped + failed}")

    print("\n[ID 매핑 테이블]")
    for mongo_id, maria_id in id_mapping.items():
        print(f"  {mongo_id} → {maria_id}")

    # 6. 정리
    mongo_client.close()
    await close_mariadb_connection()
    print("\n[DONE] 마이그레이션 완료")


if __name__ == "__main__":
    asyncio.run(migrate())
