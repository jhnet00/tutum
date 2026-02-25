"""
이메일 인증 엔드포인트 추가
"""

# /verify 엔드포인트 추가 (auth.py의 login 엔드포인트 앞에 삽입)


@router.get("/verify")
async def verify_email(token: str):
    """
    이메일 인증 처리

    - 토큰 검증 (해시 비교, 만료 확인, 사용 여부 확인)
    - 사용자 is_verified = True 업데이트
    - 토큰 used_at 업데이트 (1회성)
    """
    from app.database import get_database

    db = get_database()
    tokens_collection = db["email_verification_tokens"]
    users = get_users_collection()

    # 토큰 해시
    token_hash = hash_token(token)

    # DB에서 토큰 조회
    token_doc = await tokens_collection.find_one({"token_hash": token_hash})

    if not token_doc:
        raise HTTPException(status_code=400, detail="유효하지 않은 인증 링크입니다")

    # 만료 확인
    if token_doc["expires_at"] < datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="인증 링크가 만료되었습니다. 새로운 인증 이메일을 요청해주세요",
        )

    # 이미 사용된 토큰 확인
    if token_doc["used_at"] is not None:
        raise HTTPException(status_code=400, detail="이미 사용된 인증 링크입니다")

    # 사용자 is_verified 업데이트
    user_id = token_doc["user_id"]
    await users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"is_verified": True, "updated_at": datetime.utcnow()}},
    )

    # 토큰 used_at 업데이트
    await tokens_collection.update_one(
        {"_id": token_doc["_id"]}, {"$set": {"used_at": datetime.utcnow()}}
    )

    # 프론트엔드로 리다이렉트 (성공 페이지)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/verify-email?status=success")


@router.post("/resend-verification")
async def resend_verification(email: EmailStr):
    """
    이메일 인증 재발송

    - 이미 인증된 사용자는 에러
    - 기존 토큰 무효화
    - 새 토큰 생성 및 SQS enqueue
    """
    from app.database import get_database

    db = get_database()
    tokens_collection = db["email_verification_tokens"]
    users = get_users_collection()

    # 사용자 조회
    user_doc = await users.find_one({"email": email})
    if not user_doc:
        raise HTTPException(status_code=404, detail="등록되지 않은 이메일입니다")

    # 이미 인증된 사용자
    if user_doc.get("is_verified", False):
        raise HTTPException(status_code=400, detail="이미 인증된 계정입니다")

    user_id = str(user_doc["_id"])

    # 기존 토큰 무효화 (used_at 설정)
    await tokens_collection.update_many(
        {"user_id": user_id, "used_at": None}, {"$set": {"used_at": datetime.utcnow()}}
    )

    # 새 토큰 생성
    verification_token = generate_verification_token()
    token_hash = hash_token(verification_token)

    expires_at = datetime.utcnow() + timedelta(
        minutes=settings.VERIFICATION_TOKEN_EXPIRE_MINUTES
    )
    token_doc = {
        "user_id": user_id,
        "token_hash": token_hash,
        "expires_at": expires_at,
        "used_at": None,
        "created_at": datetime.utcnow(),
    }
    await tokens_collection.insert_one(token_doc)

    # SQS에 이메일 발송 작업 enqueue
    try:
        queue_service = get_queue_service()
        await queue_service.enqueue_verification_email(
            user_email=email, verification_token=verification_token
        )
        print(f"✅ Verification email re-queued for {email}")
    except Exception as e:
        print(f"⚠️  Failed to enqueue verification email: {e}")
        raise HTTPException(status_code=500, detail="이메일 발송에 실패했습니다")

    return {
        "message": "인증 이메일이 재발송되었습니다. 이메일을 확인해주세요.",
        "email": email,
    }
