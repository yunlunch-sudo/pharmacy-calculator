"""
처방전 OCR 백엔드 — 종이 처방전 사진을 Claude 비전으로 읽어
약품 목록 + 환자 생년월일을 구조화 JSON으로 반환한다.

프론트(웹 계산기 PWA)가 사진을 POST하면 → Claude API 호출 → JSON 반환.
ANTHROPIC_API_KEY 환경변수 필요 (Render 대시보드에서 설정).
"""
import base64
import io
import json
import os
from functools import lru_cache
from pathlib import Path

import anthropic
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# HIRA 약제급여목록표 (보험 적용 약품 ~22,000개)
# scripts/hira_to_json.py 로 매월 갱신.
DRUG_DB_PATH = Path(__file__).parent / "data" / "drug_db.json"


@lru_cache(maxsize=1)
def load_drug_db() -> dict:
    if not DRUG_DB_PATH.exists():
        return {}
    with open(DRUG_DB_PATH, encoding="utf-8") as f:
        rows = json.load(f)
    return {r["code"]: r for r in rows}

# ─────────────────────────────────────────────────────────────
# 허용 출처 (GitHub Pages 프론트 + 로컬 테스트). 추가 도메인은 env로.
# ─────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [
    "https://yunlunch-sudo.github.io",
    "http://localhost:8777",
    "http://127.0.0.1:8777",
    "http://localhost:8000",
]
_extra = os.environ.get("EXTRA_ORIGINS", "")
if _extra:
    ALLOWED_ORIGINS += [o.strip() for o in _extra.split(",") if o.strip()]

app = FastAPI(title="처방전 OCR 백엔드")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용

MODEL = "claude-opus-4-7"
MAX_LONG_EDGE = 2000  # 사진 장변 축소 한계(px) — 비용/토큰 절감, 가독성 유지


# ─────────────────────────────────────────────────────────────
# 추출 스키마
# ─────────────────────────────────────────────────────────────
class Drug(BaseModel):
    code: str = Field(description="보험코드(EDI/제품코드). 처방전에 적힌 숫자 그대로. 없으면 빈 문자열")
    name: str = Field(description="약품명 (제형·용량 포함, 처방전 표기 그대로)")
    dose_per_time: float = Field(description="1회 투약량 (예: 1, 0.5, 0.3333)")
    times_per_day: float = Field(description="1일 투여 횟수 (예: 3, 2)")
    total_days: int = Field(description="총 투약일수 (예: 5)")


class Prescription(BaseModel):
    drugs: list[Drug] = Field(description="처방된 의약품 목록 (표의 모든 행)")
    birth_6: str = Field(
        description="환자 주민등록번호 앞 6자리(YYMMDD). 보이지 않으면 빈 문자열"
    )
    hospital_name: str = Field(description="발행 의료기관(병원)명. 예: 베스트아이들병원. 없으면 빈 문자열")
    hospital_code: str = Field(description="발행기관 요양기관기호(숫자). 없으면 빈 문자열")
    notes: str = Field(description="판독 시 애매했던 점이나 참고사항(없으면 빈 문자열)")


SYSTEM = """\
당신은 대한민국 종이 처방전(병원 발행)을 읽어 약국 조제에 필요한 데이터를 추출하는 도우미입니다.
이미지에서 다음을 정확히 추출하세요.

[의약품 목록] — 처방 의약품 표의 **모든 행**을 빠짐없이:
- code: 보험코드(EDI코드/제품코드, 보통 9자리 숫자). 적혀 있으면 그대로, 없으면 "".
- name: 약품명 (제형·용량 포함, 표기 그대로). 예: "오구멘틴정375밀리그램".
- dose_per_time: 1회 투약량 (소수 가능. 예: 1, 0.5, 0.3333, 0.6667).
- times_per_day: 1일 투여 횟수.
- total_days: 총 투약일수(일분).

[환자 정보]
- birth_6: 주민등록번호 앞 6자리(YYMMDD). 가려져 있거나 없으면 "".

[발행기관]
- hospital_name: 처방전을 발행한 의료기관(병원/의원)명. 예: "베스트아이들병원". 없으면 "".
- hospital_code: 발행기관의 요양기관기호(숫자). 없으면 "".

규칙:
- 표의 숫자(1회량/횟수/일수)는 처방전에 적힌 값을 그대로 읽되, 1회량은 소수점까지.
- 약품명·코드를 추측해서 만들지 말 것. 안 보이면 빈 값.
- 손글씨·도장·서명 등은 무시하고 인쇄된 처방 표만 읽을 것.
- 약품이 아닌 항목(용법 설명, 합계 등)은 제외.
"""


def _downscale(data: bytes, content_type: str) -> tuple[bytes, str]:
    """장변이 너무 크면 축소하고 JPEG로 재인코딩. Pillow 없으면 원본 유지."""
    try:
        from PIL import Image  # noqa: PLC0415
    except Exception:
        return data, content_type or "image/jpeg"
    try:
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGB")
        w, h = img.size
        long_edge = max(w, h)
        if long_edge > MAX_LONG_EDGE:
            scale = MAX_LONG_EDGE / long_edge
            img = img.resize((int(w * scale), int(h * scale)))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return data, content_type or "image/jpeg"


@app.get("/")
def health():
    return {"status": "ok", "model": MODEL, "drugs_loaded": len(load_drug_db())}


@app.get("/api/drug-lookup")
def drug_lookup(codes: str = ""):
    """쉼표 구분 보험코드 목록 → {code: {name, price}} 반환.
    코드는 9자리로 정규화 후 매칭. HIRA 미등재(비급여)는 결과에서 빠짐.
    """
    db = load_drug_db()
    out: dict = {}
    for raw in codes.split(","):
        raw = raw.strip()
        if not raw or not raw.isdigit():
            continue
        c9 = raw.zfill(9)[-9:]
        if c9 in db:
            out[c9] = db[c9]
    return {"drugs": out}


@app.post("/api/ocr-prescription")
async def ocr_prescription(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="빈 파일")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="이미지가 너무 큽니다(25MB 초과)")

    img_bytes, media_type = _downscale(raw, file.content_type or "image/jpeg")
    b64 = base64.standard_b64encode(img_bytes).decode("utf-8")

    try:
        resp = client.messages.parse(
            model=MODEL,
            max_tokens=4000,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                    {"type": "text", "text": "이 처방전에서 의약품 목록과 환자 생년월일(YYMMDD)을 추출해 주세요."},
                ],
            }],
            output_format=Prescription,
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=500, detail="API 키 인증 실패 — ANTHROPIC_API_KEY 확인")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="요청이 많습니다. 잠시 후 다시 시도")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 오류: {e.status_code}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=503, detail="네트워크 오류")

    return resp.parsed_output.model_dump()
