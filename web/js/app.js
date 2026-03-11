/**
 * 처방전 계산기 메인 앱 (Alpine.js)
 */

// 약품 DB (drug_db.js에서 로드, 오프라인 지원)
let DRUG_DB = (typeof DRUG_DB_DATA !== 'undefined') ? DRUG_DB_DATA : [];

// 초성 매핑
const CHOSUNG = [
    'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ',
    'ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'
];

function getChosung(str) {
    let result = '';
    for (const ch of str) {
        const code = ch.charCodeAt(0) - 0xAC00;
        if (code >= 0 && code <= 11171) {
            result += CHOSUNG[Math.floor(code / 588)];
        } else {
            result += ch;
        }
    }
    return result;
}

function isAllChosung(str) {
    return /^[ㄱ-ㅎ]+$/.test(str);
}

function searchDrugs(query) {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();

    let results;
    if (/^\d+$/.test(query)) {
        // 숫자만 입력 → 보험코드 검색
        results = DRUG_DB.filter(d => d.code.includes(query));
    } else if (isAllChosung(query)) {
        // 초성 검색
        results = DRUG_DB.filter(d => getChosung(d.name).includes(query));
    } else {
        results = DRUG_DB.filter(d =>
            d.name.toLowerCase().includes(q) ||
            d.searchName.includes(q)
        );
    }
    return results.slice(0, 20);
}

// 약품명 기반 자동 분류
const TOPICAL_KEYWORDS = ['크림', '연고', '겔', '로션', '점안', '점이', '점비', '패치', '좌약', '외용', '스프레이', '안연고', '엘립타'];
const INJECTION_KEYWORDS = ['주사', '카트리지주', '프리필드'];
const NARCOTIC_KEYWORDS = ['졸피뎀', '트라마돌', '코데인', '펜타닐', '모르핀', '디아제팜', '알프라졸람', '로라제팜', '클로나제팜', '페노바르비탈', '미다졸람', '졸피담'];

function classifyDrug(name) {
    if (!name) return 'none';
    const n = name.toLowerCase();
    for (const kw of INJECTION_KEYWORDS) {
        if (n.includes(kw)) return 'injection';
    }
    for (const kw of TOPICAL_KEYWORDS) {
        if (n.includes(kw)) return 'topical';
    }
    return 'oral';
}

function isNarcoticDrug(name) {
    if (!name) return false;
    for (const kw of NARCOTIC_KEYWORDS) {
        if (name.includes(kw)) return true;
    }
    return false;
}

function createEmptyDrug() {
    return {
        name: '',
        code: '',
        unitPrice: 0,
        dosePerTime: null,
        timesPerDay: null,
        totalDays: null,
        totalQty: 0,
        amount: 0,
        coverageType: 'insured', // insured: 보험, fullPay: 100/100, nonCovered: 비급여
        suggestions: [],
        showSuggestions: false,
        suggestionIdx: -1,
    };
}

// 2026년 공휴일 목록
const HOLIDAYS_2026 = {
    '2026-01-01': '신정',
    '2026-02-16': '설날 연휴',
    '2026-02-17': '설날',
    '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절',
    '2026-03-02': '대체공휴일(삼일절)',
    '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날',
    '2026-05-25': '대체공휴일(석가탄신일)',
    '2026-06-06': '현충일',
    '2026-08-15': '광복절',
    '2026-08-17': '대체공휴일(광복절)',
    '2026-09-24': '추석 연휴',
    '2026-09-25': '추석',
    '2026-09-26': '추석 연휴',
    '2026-10-03': '개천절',
    '2026-10-05': '대체공휴일(개천절)',
    '2026-10-09': '한글날',
    '2026-12-25': '성탄절',
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function detectDayType(date) {
    const key = formatDateKey(date);
    if (HOLIDAYS_2026[key]) return 'holiday';
    const dow = date.getDay();
    if (dow === 0) return 'holiday';
    if (dow === 6) return 'saturday';
    return 'weekday';
}

function prescriptionApp() {
    const now = new Date();
    const detectedDayType = detectDayType(now);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    return {
        // 환자 정보
        birthDate: '',
        age: null,

        isPremature: false, // 조산아 F016
        insuranceType: 'health', // health: 건강보험, medical1: 의료보호1종, medical2: 의료보호2종

        // 조제 정보 - 자동/수동 모드
        manualMode: false,
        autoNow: now,
        dayType: detectedDayType,
        dispensingTime: `${hh}:${mm}`,
        isMoonlight: false,
        isNonFaceToFace: false,

        // 약품 목록
        drugs: [createEmptyDrug()],

        // 조제 옵션
        isPowder: false,
        powderDays: 0,
        hasNarcotic: false,
        hasTopical: false,
        topicalOnly: false,
        injectionOnly: false,

        // 본인부담금
        copayManual: false,
        copayRate: 0.3,  // 수동 모드용

        // UI
        showDetail: false,

        // 계산 결과
        calcResult: { items: [], totalFee: 0, appliedConditions: [] },

        init() {
            // 약품 DB는 drug_db.js에서 전역 변수로 로드됨 (오프라인 지원)
            if (DRUG_DB.length === 0 && typeof DRUG_DB_DATA !== 'undefined') {
                DRUG_DB = DRUG_DB_DATA;
            }

            // 수동/자동 모드 전환 시
            this.$watch('manualMode', (val) => {
                if (!val) {
                    // 자동 모드로 전환: 현재 시간으로 갱신
                    this.refreshNow();
                }
                this.recalcAll();
            });

            // 반응형 계산
            this.$watch('dayType', () => this.recalcAll());
            this.$watch('dispensingTime', () => this.recalcAll());
            this.$watch('isMoonlight', () => this.recalcAll());
            this.$watch('isNonFaceToFace', () => this.recalcAll());
            this.$watch('isPowder', () => this.recalcAll());
            this.$watch('powderDays', () => this.recalcAll());
            this.$watch('hasNarcotic', () => this.recalcAll());
            this.$watch('hasTopical', () => this.recalcAll());
            this.$watch('topicalOnly', () => this.recalcAll());
            this.$watch('injectionOnly', () => this.recalcAll());
            this.$watch('copayRate', () => this.recalcAll());
            this.$watch('age', () => this.recalcAll());
        },

        onBirthInput() {
            // 숫자만 허용
            this.birthDate = this.birthDate.replace(/[^0-9]/g, '').slice(0, 8);
            this.calculateAge();
        },

        calculateAge() {
            if (!this.birthDate || this.birthDate.length !== 8) { this.age = null; return; }
            const y = parseInt(this.birthDate.slice(0, 4));
            const m = parseInt(this.birthDate.slice(4, 6)) - 1;
            const d = parseInt(this.birthDate.slice(6, 8));
            if (y < 1900 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) { this.age = null; return; }
            const today = new Date();
            let a = today.getFullYear() - y;
            const dm = today.getMonth() - m;
            if (dm < 0 || (dm === 0 && today.getDate() < d)) a--;
            this.age = Math.max(0, a);
        },

        // 자동 모드 표시용 computed
        get autoDateDisplay() {
            const d = this.autoNow;
            return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
        },

        get autoTimeDisplay() {
            const d = this.autoNow;
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        },

        get autoDayLabel() {
            const dt = detectDayType(this.autoNow);
            if (dt === 'holiday') return { text: '공휴일/일요일', cls: 'tag-red' };
            if (dt === 'saturday') return { text: '토요일', cls: 'tag-blue' };
            return { text: '평일', cls: 'tag-green' };
        },

        get autoHolidayName() {
            const key = formatDateKey(this.autoNow);
            return HOLIDAYS_2026[key] || '';
        },

        refreshNow() {
            const now = new Date();
            this.autoNow = now;
            if (!this.manualMode) {
                this.dayType = detectDayType(now);
                const hh = String(now.getHours()).padStart(2, '0');
                const mm = String(now.getMinutes()).padStart(2, '0');
                this.dispensingTime = `${hh}:${mm}`;
            }
        },

        get timeLabel() {
            const hour = this.currentHour;
            if (this.dayType !== 'weekday') {
                return { text: '휴일(종일가산)', cls: 'tag-orange' };
            }
            if (hour >= 9 && hour < 18) {
                return { text: '주간', cls: 'tag-green' };
            }
            if (hour >= 20 && this.age !== null && this.age < 6) {
                return { text: '소아심야', cls: 'tag-red-bold' };
            }
            return { text: '시간외', cls: 'tag-orange' };
        },

        get currentHour() {
            const parts = this.dispensingTime.split(':');
            return parseInt(parts[0]) || 10;
        },

        // 최대 투약일수 (처방 내역에서 자동 추출)
        get maxDays() {
            let max = 0;
            for (const d of this.drugs) {
                if (d.totalDays > max) max = d.totalDays;
            }
            return max || 3; // 기본 3일
        },

        get drugTotal() {
            return this.drugs.reduce((sum, d) => sum + (d.amount || 0), 0);
        },

        // 보험 유형별 약품비 분리
        get insuredDrugTotal() {
            return this.drugs.filter(d => d.coverageType === 'insured').reduce((s, d) => s + (d.amount || 0), 0);
        },
        get fullPayDrugTotal() {
            return this.drugs.filter(d => d.coverageType === 'fullPay').reduce((s, d) => s + (d.amount || 0), 0);
        },
        get nonCoveredDrugTotal() {
            return this.drugs.filter(d => d.coverageType === 'nonCovered').reduce((s, d) => s + (d.amount || 0), 0);
        },

        get grandTotal() {
            return this.drugTotal + this.calcResult.totalFee;
        },

        // 보험 적용 총액 (보험약 + 처방조제료). 비급여만 있으면 조제료도 비급여
        get insuredTotal() {
            const hasInsuredDrugs = this.drugs.some(d => d.name && (d.coverageType === 'insured' || d.coverageType === 'fullPay'));
            if (hasInsuredDrugs) {
                return this.insuredDrugTotal + this.calcResult.totalFee;
            }
            // 비급여만 있거나 약품 없음 → 조제료도 비보험
            return 0;
        },

        // 본인부담금 자동 계산 (보험유형+나이+총액 기반)
        get copayInfo() {
            const fullPay = this.fullPayDrugTotal;
            const nonCovered = this.nonCoveredDrugTotal;
            const nonCoveredFee = (nonCovered > 0 && this.insuredDrugTotal === 0 && fullPay === 0)
                ? this.calcResult.totalFee : 0;
            const extraPay = fullPay + nonCovered + nonCoveredFee;

            if (this.copayManual) {
                const base = Math.floor(this.grandTotal * this.copayRate / 10) * 10;
                return { amount: base, desc: '수동 설정', rate: this.copayRate };
            }

            // 자동차보험/산재보험/기타: 전액 본인부담
            if (this.insuranceType === 'auto' || this.insuranceType === 'industrial' || this.insuranceType === 'etc') {
                const labels = { auto: '자동차보험', industrial: '산재보험', etc: '기타' };
                return { amount: this.grandTotal, desc: labels[this.insuranceType] + ' → 100%', rate: 1.0 };
            }

            // 보험 적용 부분의 본인부담 계산
            const insured = this.insuredTotal;
            let insuredCopay = 0;
            let desc = '';

            if (this.insuranceType === 'subHealth') {
                insuredCopay = insured > 0 ? 500 : 0;
                desc = '차상위 → 500원';
            } else if (this.insuranceType === 'medical1') {
                insuredCopay = 0;
                desc = '의료급여 1종 → 0원';
            } else if (this.insuranceType === 'medical2') {
                insuredCopay = insured > 0 ? 500 : 0;
                desc = '의료급여 2종 → 500원';
            } else {
                // 건강보험: 비급여 약품비 포함한 전체 금액 기준으로 본인부담률 적용 후, 비급여는 별도 추가
                const total = this.grandTotal;
                const age = this.age;

                if (this.isPremature) {
                    insuredCopay = Math.ceil(total * 0.05 / 100) * 100;
                    desc = '조산아 F016 → 5%';
                } else if (age !== null && age >= 65) {
                    if (total <= 10000) {
                        insuredCopay = total > 0 ? 1000 : 0;
                        desc = '65세이상 / 1만원이하 → 정액';
                    } else if (total <= 12000) {
                        insuredCopay = Math.ceil(total * 0.2 / 100) * 100;
                        desc = '65세이상 / 1~1.2만원 → 20%';
                    } else {
                        insuredCopay = Math.ceil(total * 0.3 / 100) * 100;
                        desc = '65세이상 / 1.2만원초과 → 30%';
                    }
                } else if (age !== null && age < 6) {
                    insuredCopay = Math.ceil(total * 0.2 / 100) * 100;
                    desc = '6세미만 → 20%';
                } else {
                    insuredCopay = Math.ceil(total * 0.3 / 100) * 100;
                    desc = '일반 → 30%';
                }
            }

            const totalCopay = insuredCopay + extraPay;
            if (extraPay > 0) {
                desc += ' + 비보험 ₩' + extraPay.toLocaleString();
            }
            return { amount: totalCopay, desc: desc, rate: null };
        },

        get copayAmount() {
            return this.copayInfo.amount;
        },

        get insuranceAmount() {
            return this.grandTotal - this.copayAmount;
        },

        // 셀 네비게이션
        focusCell(row, field) {
            this.$nextTick(() => {
                const el = document.querySelector(`[data-row="${row}"][data-field="${field}"]`);
                if (el) { el.focus(); el.select && el.select(); }
            });
        },

        onNameEnter(idx) {
            const d = this.drugs[idx];
            // 자동완성 선택 처리
            if (d.showSuggestions && d.suggestions.length > 0) {
                if (d.suggestionIdx >= 0) {
                    this.selectDrug(idx, d.suggestions[d.suggestionIdx]);
                } else if (d.suggestions.length === 1) {
                    this.selectDrug(idx, d.suggestions[0]);
                }
            }
            // 약품명이 있으면 다음 필드로 이동
            if (d.name) {
                this.focusCell(idx, 'dosePerTime');
            }
        },

        onLastFieldEnter(idx) {
            // 마지막 필드(총일수)에서 엔터 → 다음 행의 약품명으로 이동
            const nextIdx = idx + 1;
            if (nextIdx >= this.drugs.length) {
                this.addDrugRow();
            }
            this.focusCell(nextIdx, 'name');
        },

        onCellNav(idx, field, dir, event) {
            const fields = ['name', 'dosePerTime', 'timesPerDay', 'totalDays'];
            const curIdx = fields.indexOf(field);

            if (field === 'name') {
                // 약품명에서는 오른쪽 화살표만 (커서가 끝에 있을 때)
                const input = event.target;
                if (dir === 'right' && input.selectionStart === input.value.length) {
                    event.preventDefault();
                    this.focusCell(idx, fields[curIdx + 1]);
                }
                return;
            }

            if (dir === 'right' && curIdx < fields.length - 1) {
                event.preventDefault();
                this.focusCell(idx, fields[curIdx + 1]);
            } else if (dir === 'left' && curIdx > 0) {
                event.preventDefault();
                this.focusCell(idx, fields[curIdx - 1]);
            }
        },

        // 약품 급여 유형 순환 (보험 → 100/100 → 비급여)
        cycleCoverage(idx) {
            const order = ['insured', 'fullPay', 'nonCovered'];
            const cur = order.indexOf(this.drugs[idx].coverageType);
            this.drugs[idx].coverageType = order[(cur + 1) % 3];
            this.recalcAll();
        },

        // 약품 관련
        onDrugSearch(idx, value) {
            const prev = this.drugs[idx].name;
            this.drugs[idx].name = value;
            if (value.length >= 1) {
                this.drugs[idx].suggestions = searchDrugs(value);
                this.drugs[idx].showSuggestions = true;
                this.drugs[idx].suggestionIdx = -1;
            } else {
                this.drugs[idx].suggestions = [];
                this.drugs[idx].showSuggestions = false;
                // 약품명이 지워진 경우 옵션 재감지
                if (prev) this.autoDetectOptions();
            }
        },

        onDrugFocus(idx) {
            if (this.drugs[idx].name.length >= 1) {
                this.drugs[idx].suggestions = searchDrugs(this.drugs[idx].name);
                this.drugs[idx].showSuggestions = true;
            }
        },

        closeSuggestions(idx) {
            this.drugs[idx].showSuggestions = false;
            // 포커스 벗어날 때 옵션 재감지
            this.autoDetectOptions();
        },

        moveSuggestion(idx, dir) {
            const d = this.drugs[idx];
            if (!d.suggestions.length) return;
            d.suggestionIdx = Math.max(-1, Math.min(d.suggestions.length - 1, d.suggestionIdx + dir));
        },

        selectSuggestionByKey(idx) {
            const d = this.drugs[idx];
            if (d.suggestionIdx >= 0 && d.suggestionIdx < d.suggestions.length) {
                this.selectDrug(idx, d.suggestions[d.suggestionIdx]);
            } else if (d.suggestions.length === 1) {
                this.selectDrug(idx, d.suggestions[0]);
            }
        },

        selectDrug(idx, drug) {
            this.drugs[idx].name = drug.name;
            this.drugs[idx].code = drug.code;
            this.drugs[idx].coverageType = (drug.note === '비보험') ? 'nonCovered' : 'insured';
            // 비급여 약품은 localStorage에 저장된 가격 우선 적용
            if (drug.note === '비보험') {
                const saved = localStorage.getItem('nonCoveredPrice_' + drug.code);
                this.drugs[idx].unitPrice = saved ? Number(saved) : drug.price;
            } else {
                this.drugs[idx].unitPrice = drug.price;
            }
            this.drugs[idx].showSuggestions = false;
            this.drugs[idx].suggestions = [];
            this.recalcDrug(idx);
            this.autoDetectOptions();
            this.focusCell(idx, 'dosePerTime');
        },

        onNonCoveredPriceChange(idx) {
            const d = this.drugs[idx];
            const price = parseInt(d.unitPrice) || 0;
            d.unitPrice = price;
            if (d.code) {
                localStorage.setItem('nonCoveredPrice_' + d.code, price);
            }
            this.recalcDrug(idx);
        },

        recalcDrug(idx) {
            const d = this.drugs[idx];
            d.totalQty = Math.round((d.dosePerTime || 0) * (d.timesPerDay || 0) * (d.totalDays || 0) * 100) / 100;
            d.amount = Math.round(d.unitPrice * d.totalQty);
            this.recalcAll();
        },

        printCounseling() {
            // 약품명이 있는 약만 필터
            const activeDrugs = this.drugs.filter(d => d.name && d.name.trim());
            if (activeDrugs.length === 0) {
                alert('처방 약품을 먼저 입력해 주세요.');
                return;
            }

            const today = new Date();
            const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

            // 카드 HTML 생성
            const cardColors = ['#1d6fad','#2d7f3a','#a3440e','#6b2fa0','#a0522d','#1a7a7a','#8b1a1a'];
            const cards = activeDrugs.map((drug, i) => {
                const c = findCounseling(drug.name);
                const color = cardColors[i % cardColors.length];
                const doseDesc = drug.dosePerTime && drug.timesPerDay && drug.totalDays
                    ? `1회 ${drug.dosePerTime}개(정/포/ml)씩, 1일 ${drug.timesPerDay}회, ${drug.totalDays}일분`
                    : '';
                return `
                <div class="drug-card">
                    <div class="card-header" style="background:${color}">
                        <span class="card-name">${drug.name.replace(/\(.*?\)/g,'').replace(/_\(.*?\)/g,'').trim()}</span>
                        ${c ? `<span class="card-ingredient">${c.name}</span>` : ''}
                    </div>
                    <div class="card-body">
                        ${c ? `
                        <table class="info-table">
                            <tr><th>효&nbsp;&nbsp;&nbsp;능</th><td>${c.efficacy}</td></tr>
                            <tr><th>성분/함량</th><td>${c.ingredient}</td></tr>
                            <tr><th>모&nbsp;&nbsp;&nbsp;양</th><td>${c.shape}</td></tr>
                            ${doseDesc ? `<tr><th>복 용 량</th><td><strong>${doseDesc}</strong></td></tr>` : ''}
                            <tr><th>복 용 법</th><td>${c.method}</td></tr>
                            <tr><th>보 관 법</th><td>${c.storage}</td></tr>
                            <tr><th>부 작 용</th><td>${c.sideEffects}</td></tr>
                        </table>
                        <div class="precautions">
                            <span class="prec-label">⚠ 주의사항</span> ${c.precautions}
                        </div>
                        ` : `
                        <div class="no-data">
                            ${doseDesc ? `<p><strong>${doseDesc}</strong></p>` : ''}
                            <p style="color:#888;font-size:10px">복약지도 정보를 준비 중입니다.</p>
                        </div>
                        `}
                    </div>
                </div>`;
            }).join('');

            const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>복약안내문</title>
<style>
  @page { size: A4 portrait; margin: 8mm 8mm 8mm 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  body { font-size: 10px; color: #222; }
  .page-header { text-align: center; margin-bottom: 5mm; padding-bottom: 3mm; border-bottom: 2px solid #333; }
  .page-header h1 { font-size: 16px; font-weight: bold; letter-spacing: 4px; }
  .page-header .sub { font-size: 10px; color: #555; margin-top: 2px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .drug-card { border: 1px solid #ccc; border-radius: 3px; overflow: hidden; page-break-inside: avoid; }
  .card-header { padding: 3px 6px; display: flex; align-items: baseline; gap: 5px; }
  .card-name { font-size: 11px; font-weight: bold; color: #fff; flex-shrink: 0; }
  .card-ingredient { font-size: 9px; color: rgba(255,255,255,0.85); }
  .card-body { padding: 4px 5px; }
  .info-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  .info-table th { width: 52px; color: #444; font-weight: 600; text-align: left; padding: 1.5px 3px; white-space: nowrap; vertical-align: top; }
  .info-table td { padding: 1.5px 3px; color: #222; vertical-align: top; line-height: 1.4; }
  .info-table tr:nth-child(odd) td, .info-table tr:nth-child(odd) th { background: #f9f9f9; }
  .precautions { margin-top: 3px; background: #fff8e8; border-left: 3px solid #f0a500; padding: 3px 5px; font-size: 9px; line-height: 1.4; color: #555; }
  .prec-label { font-weight: bold; color: #c07000; }
  .no-data { padding: 6px; color: #666; font-size: 9px; }
  .page-footer { margin-top: 5mm; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #ccc; padding-top: 2mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="page-header">
    <h1>복 약 안 내 문</h1>
    <div class="sub">윤약국 &nbsp;|&nbsp; 발행일: ${dateStr} &nbsp;|&nbsp; 총 ${activeDrugs.length}가지 약품</div>
  </div>
  <div class="grid">${cards}</div>
  <div class="page-footer">본 복약안내문은 복약지도를 보조하기 위한 자료입니다. 궁금한 사항은 약사에게 문의하세요.</div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;

            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
        },

        addDrugRow() {
            this.drugs.push(createEmptyDrug());
        },

        removeDrugRow() {
            if (this.drugs.length > 1) {
                this.drugs.pop();
                this.autoDetectOptions();
            }
        },

        // 약품 목록 기반 조제 옵션 자동 감지
        autoDetectOptions() {
            const named = this.drugs.filter(d => d.name);
            if (named.length === 0) {
                this.hasNarcotic = false;
                this.hasTopical = false;
                this.topicalOnly = false;
                this.injectionOnly = false;
                this.recalcAll();
                return;
            }

            // 마약류 감지
            this.hasNarcotic = named.some(d => isNarcoticDrug(d.name));

            // 약품 유형별 분류
            const categories = named.map(d => classifyDrug(d.name));
            const hasOral = categories.includes('oral');
            const hasTopical = categories.includes('topical');
            const hasInjection = categories.includes('injection');

            if (!hasOral && hasTopical && !hasInjection) {
                // 외용제만
                this.topicalOnly = true;
                this.injectionOnly = false;
                this.hasTopical = false;
            } else if (!hasOral && !hasTopical && hasInjection) {
                // 주사제만
                this.injectionOnly = true;
                this.topicalOnly = false;
                this.hasTopical = false;
            } else if (hasOral && hasTopical) {
                // 내복약 + 외용제
                this.hasTopical = true;
                this.topicalOnly = false;
                this.injectionOnly = false;
            } else {
                // 내복약만 등
                this.hasTopical = false;
                this.topicalOnly = false;
                this.injectionOnly = false;
            }

            this.recalcAll();
        },

        recalcAll() {
            const hour = this.currentHour;
            const age = this.age !== null ? this.age : 30;

            const inp = {
                days: this.maxDays,
                age: age,
                hour: hour,
                isHoliday: this.dayType === 'holiday',
                isSaturday: this.dayType === 'saturday',
                isPowder: this.isPowder,
                powderDays: this.powderDays || 0,
                hasNarcotic: this.hasNarcotic,
                hasTopical: this.hasTopical,
                hasInjection: false,
                topicalOnly: this.topicalOnly,
                injectionOnly: this.injectionOnly,
                isNonFaceToFace: this.isNonFaceToFace,
                isMoonlightPharmacy: this.isMoonlight,
            };

            this.calcResult = calculate(inp);
        },

        // 전체 초기화 (새 처방)
        resetAll() {
            this.birthDate = '';
            this.age = null;
            this.isPremature = false;
            this.insuranceType = 'health';
            this.isMoonlight = false;
            this.isNonFaceToFace = false;
            this.drugs = [createEmptyDrug()];
            this.isPowder = false;
            this.powderDays = 0;
            this.hasNarcotic = false;
            this.hasTopical = false;
            this.topicalOnly = false;
            this.injectionOnly = false;
            this.copayManual = false;
            this.copayRate = 0.3;
            this.showDetail = false;
            this.refreshNow();
            this.recalcAll();
            // 스크롤 맨 위로 + 첫 약품명에 포커스
            window.scrollTo(0, 0);
            this.focusCell(0, 'name');
        },
    };
}
