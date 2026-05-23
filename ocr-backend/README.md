# 처방전 OCR 백엔드

종이 처방전 사진을 Claude 비전(Opus 4.7)으로 읽어 **약품 목록 + 환자 생년월일**을 JSON으로 반환하는 작은 FastAPI 서버. 웹 계산기(PWA)의 📷 버튼이 이 서버를 호출한다.

## API

`POST /api/ocr-prescription` (multipart, 필드명 `file` = 이미지)

응답:
```json
{
  "drugs": [
    {"code": "655401500", "name": "오구멘틴정375밀리그램", "dose_per_time": 1, "times_per_day": 3, "total_days": 5}
  ],
  "birth_6": "201005",
  "notes": ""
}
```

`GET /` → 헬스체크.

## 로컬 실행

```bash
cd ocr-backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload --port 8090
# 테스트
curl -F "file=@처방전.jpg" http://127.0.0.1:8090/api/ocr-prescription
```

## Render 배포

1. 이 저장소를 Render에 연결 → **New Web Service** (또는 `render.yaml` 자동 인식)
   - rootDir: `ocr-backend`
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
2. **Environment**에 `ANTHROPIC_API_KEY` 추가 (시크릿, console.anthropic.com에서 발급)
3. 배포 후 URL(예: `https://prescription-ocr.onrender.com`)을 웹 계산기 `web/js/app.js`의 `OCR_API_URL`에 설정
4. 프론트가 GitHub Pages가 아닌 다른 도메인이면 `EXTRA_ORIGINS`에 추가

## 비용·주의
- 스캔당 Claude 비전 호출 = 수 센트. 이미지는 장변 2000px로 자동 축소해 비용·토큰 절감.
- 처방전은 환자 민감정보 → 이미지·결과를 **저장하지 않음**(메모리에서 처리 후 폐기).
- OCR은 100%가 아니므로 프론트에서 **사용자 확인/수정 단계** 후 계산.
