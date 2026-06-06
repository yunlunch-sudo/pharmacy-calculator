/**
 * 처방전 계산기 메인 앱 (Alpine.js)
 */

// 약품 DB (drug_db.js에서 로드, 오프라인 지원)
let DRUG_DB = (typeof DRUG_DB_DATA !== 'undefined') ? DRUG_DB_DATA : [];

// 📷 처방전 OCR 백엔드 주소 (Render 배포)
const OCR_API_URL = 'https://prescription-ocr-uj3z.onrender.com';

// 달빛 협약 병원 — 베스트아이들병원(요양기관기호 31211283)만 달빛 적용.
// 다른 병원 처방전은 달빛 무조건 미적용.
const MOONLIGHT_HOSPITAL_CODES = ['31211283'];
const MOONLIGHT_HOSPITAL_NAMES = ['베스트아이들'];

// 약품코드를 9자리로 정규화 (DB에 앞 0 빠진 8자리 코드 호환)
function normCode(c) {
    const s = String(c || '').replace(/\D/g, '');
    if (!s) return '';
    return s.length < 9 ? s.padStart(9, '0') : s.slice(-9);
}

// 내 약국 개인 약품DB (localStorage) — 신규/누락 약품을 사용자가 한 번 입력하면 누적 학습
function loadLocalDrugDb() {
    try { return JSON.parse(localStorage.getItem('localDrugDb') || '{}'); }
    catch (e) { return {}; }
}
function saveLocalDrugDb(db) {
    try { localStorage.setItem('localDrugDb', JSON.stringify(db)); } catch (e) {}
}
function rememberDrug(row) {
    const code = normCode(row.code);
    if (!code || !row.name) return;
    const db = loadLocalDrugDb();
    const prev = db[code] || {};
    db[code] = {
        code: code,
        name: row.name,
        price: Number(row.unitPrice) || prev.price || 0,
        coverageType: row.coverageType || prev.coverageType || 'insured',
        isIncentive: !!row.isIncentive,
        updatedAt: Date.now()
    };
    saveLocalDrugDb(db);
}
// 키 호환 lookup: 정규화 코드 → 원본 코드 순으로 fallback
function lsGet(prefix, code) {
    if (!code) return null;
    const n = normCode(code);
    return localStorage.getItem(prefix + n) || localStorage.getItem(prefix + code);
}

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

    // 개인DB + 기본DB 합치기 (개인DB 우선, 코드 정규화 기준 중복 제거)
    const local = Object.values(loadLocalDrugDb()).map(d => ({
        ...d, _local: true, searchName: (d.name || '').toLowerCase()
    }));
    const seen = new Set(local.map(d => normCode(d.code)));
    const merged = local.concat(DRUG_DB.filter(d => !seen.has(normCode(d.code))));

    let results;
    if (/^\d+$/.test(query)) {
        // 숫자만 입력 → 보험코드 검색 (정규화 매칭 + 부분일치)
        const qn = normCode(query);
        results = merged.filter(d => normCode(d.code) === qn || (d.code || '').includes(query));
    } else if (isAllChosung(query)) {
        // 초성 검색
        results = merged.filter(d => getChosung(d.name).includes(query));
    } else {
        results = merged.filter(d =>
            d.name.toLowerCase().includes(q) ||
            (d.searchName || '').toString().includes(q)
        );
    }
    return results.slice(0, 20);
}

// 약품명 기반 자동 분류
const TOPICAL_KEYWORDS = ['크림', '연고', '로션', '로오션', '점안', '점이', '점비', '패치', '패취', '좌약', '좌제', '외용', '스프레이', '분무', '안연고', '엘립타', '할러', '디스커스', '레스피맷', '핸디헬러', '흡입', '네뷸', '가글', '함수'];
// '겔'은 외용 겔(페리톡겔 등)과 먹는 제산제(알마겔정·포타겔현탁액·겔포스 등)가 충돌 → 내복약 제형이 없을 때만 외용으로 판정
const TOPICAL_GEL_KEYWORD = '겔';
const ORAL_FORM_KEYWORDS = ['정', '캡슐', '시럽', '현탁액', '과립', '세립', '드롭스', '경구', '트로키', '환'];
// 자가투여주사 (환자가 직접 놓는 펜·프리필드·카트리지·성장호르몬·인슐린·GLP-1 등) → 외용제와 동일하게 F(16.20점) 적용
const SELF_INJECTION_KEYWORDS = [
    '펜주', '프리필드', '카트리지주', '자가투여', '자가주사',
    '인슐린', '란투스', '노보래피드', '휴물린', '휴마로그', '레버미어', '트레시바', '아피드라', '노보믹스',
    '유트로핀', '사이젠', '지노트로핀', '옴니트로프', '휴마트로프', '노디트로핀', '그로트로핀', '이지피프티',
    '빅토자', '트룰리시티', '오젬픽', '위고비', '삭센다', '마운자로',  // GLP-1
    '엔브렐', '휴미라', '심포니', '코센틱스', '스텔라라', '레미케이드',  // 생물학적제제 자가주사
];
// 약국조제 주사제(병원 투여용으로 약국에서 조제) → G(5.45점)
const INJECTION_KEYWORDS = ['주사'];
const NARCOTIC_KEYWORDS = ['졸피뎀', '트라마돌', '코데인', '펜타닐', '모르핀', '디아제팜', '알프라졸람', '로라제팜', '클로나제팜', '페노바르비탈', '미다졸람', '졸피담'];

// 약국 정보 (약제비 계산서·영수증·복약안내문 발행처). 윤약국은 영수증에 전화번호 미표기.
const PHARMACY_INFO = {
    name: '윤약국',
    owner: '윤중식',
    bizNo: '3020259468',  // 사업자등록번호 (영수증 표기: 하이픈 없음)
    address: '경기도 화성시 동탄지성로 18 금정프라자 101호',
};

// 약국 직인(원형 인감) — 영수증 성명란에 빨간색으로 날인
const STAMP_SVG = `<svg class="r-seal" width="34" height="34" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">`
    + `<circle cx="60" cy="60" r="56" fill="none" stroke="#C8102E" stroke-width="5"/>`
    + `<circle cx="60" cy="60" r="47" fill="none" stroke="#C8102E" stroke-width="1.5"/>`
    + `<text x="60" y="41" text-anchor="middle" fill="#C8102E" font-size="33" font-weight="800">윤</text>`
    + `<text x="38" y="85" text-anchor="middle" fill="#C8102E" font-size="33" font-weight="800">약</text>`
    + `<text x="82" y="85" text-anchor="middle" fill="#C8102E" font-size="33" font-weight="800">국</text>`
    + `</svg>`;

function classifyDrug(name) {
    if (!name) return 'none';
    const n = name.toLowerCase();
    // 자가투여주사 (펜주·인슐린·성장호르몬 등) → 단독 처방일 때만 자가투여주사 조제료(F).
    // 경구·외용과 함께 처방되면 가산 미적용이므로 'topical'과 구분해 별도 분류한다.
    for (const kw of SELF_INJECTION_KEYWORDS) {
        if (n.includes(kw.toLowerCase())) return 'self_injection';
    }
    for (const kw of INJECTION_KEYWORDS) {
        if (n.includes(kw)) return 'injection';
    }
    for (const kw of TOPICAL_KEYWORDS) {
        if (n.includes(kw)) return 'topical';
    }
    // '겔': 외용 겔(페리톡겔 등)은 외용, 먹는 제산제(알마겔정·포타겔현탁액 등)는 내복으로 분류
    if (name.includes(TOPICAL_GEL_KEYWORD) && !ORAL_FORM_KEYWORDS.some(f => name.includes(f))) {
        return 'topical';
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
        isIncentive: false, // 저가인센티브(저가약): 본인부담 별도 100원 올림
        suggestions: [],
        showSuggestions: false,
        suggestionIdx: -1,
        _rawEng: '',
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
        patientName: '',
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
        noDispensingFee: false,

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

        // OCR (처방전 사진 입력)
        ocrLoading: false,
        ocrStatus: '',

        // 발행기관 (달빛 협약 판별용)
        issuingHospital: '',
        issuingHospitalCode: '',

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
            // 숫자만 허용, 6자리
            this.birthDate = this.birthDate.replace(/[^0-9]/g, '').slice(0, 6);
            this.calculateAge();
        },

        calculateAge() {
            if (!this.birthDate || this.birthDate.length !== 6) { this.age = null; return; }
            const yy = parseInt(this.birthDate.slice(0, 2));
            const m = parseInt(this.birthDate.slice(2, 4)) - 1;
            const d = parseInt(this.birthDate.slice(4, 6));
            // 00~29 → 2000년대, 30~99 → 1900년대
            const y = yy <= 29 ? 2000 + yy : 1900 + yy;
            if (m < 0 || m > 11 || d < 1 || d > 31) { this.age = null; return; }
            const today = new Date();
            let a = today.getFullYear() - y;
            const dm = today.getMonth() - m;
            if (dm < 0 || (dm === 0 && today.getDate() < d)) a--;
            this.age = Math.max(0, a);
        },

        // 달빛 협약 병원 여부 (베스트아이들병원만). 발행기관 정보 없으면(수동입력) 사용자 판단 허용.
        get moonlightAllowed() {
            if (!this.issuingHospital && !this.issuingHospitalCode) return true;
            if (MOONLIGHT_HOSPITAL_CODES.includes(this.issuingHospitalCode)) return true;
            if (this.issuingHospital && MOONLIGHT_HOSPITAL_NAMES.some(n => this.issuingHospital.indexOf(n) >= 0)) return true;
            return false;
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
            // 급여 약가합계는 10원 절사 (약국 프로그램 청구 기준: 원단위 버림)
            return this.insuredDrugTotalTrunc + this.fullPayDrugTotal + this.nonCoveredDrugTotal;
        },

        // 보험 유형별 약품비 분리
        get insuredDrugTotal() {
            return this.drugs.filter(d => d.coverageType === 'insured').reduce((s, d) => s + (d.amount || 0), 0);
        },
        // 저가인센티브 약가 합 (본인부담 별도 100원 올림 대상)
        get insuredDrugIncentiveTotal() {
            return this.drugs.filter(d => d.coverageType === 'insured' && d.isIncentive)
                             .reduce((s, d) => s + (d.amount || 0), 0);
        },
        // 일반(인센티브 제외) 보험약가
        get insuredDrugMainTotal() {
            return this.insuredDrugTotal - this.insuredDrugIncentiveTotal;
        },
        // 급여 약가합계 10원 절사 (청구 기준, 인센티브 포함)
        get insuredDrugTotalTrunc() {
            return Math.floor(this.insuredDrugTotal / 10) * 10;
        },
        // 본인부담 일반약가분: 보험약을 품목별로 각각 끝수처리(100원)하기 위한 약가 목록
        // 약국 청구 프로그램 실측: 같은 투약일수라도 약품마다 따로 올림/반올림한다 (그룹 합산이 아님)
        get insuredMainGroupSums() {
            return this.drugs
                .filter(d => d.coverageType === 'insured' && !d.isIncentive && (d.name || d.amount))
                .map(d => d.amount || 0);
        },
        get fullPayDrugTotal() {
            return this.drugs.filter(d => d.coverageType === 'fullPay').reduce((s, d) => s + (d.amount || 0), 0);
        },
        get nonCoveredDrugTotal() {
            return this.drugs.filter(d => d.coverageType === 'nonCovered').reduce((s, d) => s + (d.amount || 0), 0);
        },

        get grandTotal() {
            const fee = this.noDispensingFee ? 0 : this.calcResult.totalFee;
            return this.drugTotal + fee;
        },

        // 보험 적용 총액 (보험약 + 처방조제료). 비급여만 있으면 조제료도 비급여
        get insuredTotal() {
            if (this.noDispensingFee) return 0;
            const hasInsuredDrugs = this.drugs.some(d => d.name && (d.coverageType === 'insured' || d.coverageType === 'fullPay'));
            if (hasInsuredDrugs) {
                return this.insuredDrugTotalTrunc + this.calcResult.totalFee;
            }
            // 비급여만 있거나 약품 없음 → 조제료도 비보험
            return 0;
        },

        // 비급여(전액본인부담) 합계: 100/100 약가 + 비급여 약가 (+ 비급여만일 때 조제료)
        get extraPayTotal() {
            const fullPay = this.fullPayDrugTotal;
            const nonCovered = this.nonCoveredDrugTotal;
            const nonCoveredFee = (!this.noDispensingFee && nonCovered > 0 && this.insuredDrugTotal === 0 && fullPay === 0)
                ? this.calcResult.totalFee : 0;
            return fullPay + nonCovered + nonCoveredFee;
        },

        // 본인부담금 자동 계산 (보험유형+나이+총액 기반)
        get copayInfo() {
            const fullPay = this.fullPayDrugTotal;
            const extraPay = this.extraPayTotal;

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
                // 건강보험: 본인부담률 적용. 약국 프로그램 방식 →
                // 조제료분과 약품비분(10원 절사)을 각각 100원 올림 후 합산 (구간 판정은 총액 기준)
                const total = insured; // insuredTotal (보험약 절사 + 조제료)
                const age = this.age;
                const feeForCopay = this.noDispensingFee ? 0 : this.calcResult.totalFee;
                const feeInsured = (this.insuredDrugTotal > 0 || fullPay > 0) ? feeForCopay : 0;
                const mainGroups = this.insuredMainGroupSums;           // 일반약가분: 투약일수 그룹별
                const incentive = this.insuredDrugIncentiveTotal;       // 저가인센티브분(별도)
                // 끝수처리(100원) 실측 확정: 6세미만(조산아 제외)은 전부 올림 /
                // 그 외(성인·65세·조산아)는 조제료분 내림(floor), 약가·인센분 반올림
                const isCeil = (age !== null && age < 6 && !this.isPremature);
                const rFee = isCeil ? (x => Math.ceil(x / 100) * 100) : (x => Math.floor(x / 100) * 100);
                const rDrug = isCeil ? (x => Math.ceil(x / 100) * 100) : (x => Math.round(x / 100) * 100);
                const pct = (rate) => rFee(feeInsured * rate)
                                    + mainGroups.reduce((s, g) => s + rDrug(g * rate), 0)
                                    + rDrug(incentive * rate);

                if (this.isPremature) {
                    // 조산아(F016) 5%: 항목별 반올림 (성인과 동일 끝수처리)
                    insuredCopay = pct(0.05);
                    desc = '조산아 F016 → 5%';
                } else if (age !== null && age >= 65) {
                    if (total <= 10000) {
                        insuredCopay = total > 0 ? 1000 : 0;
                        desc = '65세이상 / 1만원이하 → 정액';
                    } else if (total <= 12000) {
                        insuredCopay = pct(0.2);
                        desc = '65세이상 / 1~1.2만원 → 20%';
                    } else {
                        insuredCopay = pct(0.3);
                        desc = '65세이상 / 1.2만원초과 → 30%';
                    }
                } else if (age !== null && age < 6) {
                    insuredCopay = pct(0.2);
                    desc = '6세미만 → 20%';
                } else {
                    insuredCopay = pct(0.3);
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

        // 약품 급여 유형 순환 (보험 → 100/100 → 비급여), 개인DB에도 저장
        cycleCoverage(idx) {
            const order = ['insured', 'fullPay', 'nonCovered'];
            const cur = order.indexOf(this.drugs[idx].coverageType);
            const next = order[(cur + 1) % 3];
            this.drugs[idx].coverageType = next;
            const d = this.drugs[idx];
            if (d.code) localStorage.setItem('drugCoverage_' + normCode(d.code), next);
            if (d.code && d.name) rememberDrug(d);
            this.recalcAll();
        },

        // 저가인센티브 토글, 개인DB에도 저장
        toggleIncentive(idx) {
            const next = !this.drugs[idx].isIncentive;
            this.drugs[idx].isIncentive = next;
            const d = this.drugs[idx];
            if (d.code) localStorage.setItem('drugIncentive_' + normCode(d.code), next ? '1' : '0');
            if (d.code && d.name) rememberDrug(d);
            this.recalcAll();
        },

        // 약품 관련 — 영타→한타 자동 변환 (keydown에서 영문 가로채기)
        onDrugKeydown(idx, event) {
            const drug = this.drugs[idx];
            if (!drug._rawEng) drug._rawEng = '';
            const key = event.key;

            // 영문 알파벳이고 한글 키보드 매핑에 있는 키
            if (key.length === 1 && /[a-zA-Z]/.test(key) && ENG_KEY_MAP[key]) {
                event.preventDefault();
                drug._rawEng += key;
                const converted = engToKor(drug._rawEng);
                drug.name = converted;
                event.target.value = converted;
                this._updateDrugSuggestions(idx, converted);
                return;
            }

            // Backspace: 영문 버퍼에서 한 글자 제거 후 재변환
            if (key === 'Backspace' && drug._rawEng.length > 0) {
                event.preventDefault();
                drug._rawEng = drug._rawEng.slice(0, -1);
                const converted = drug._rawEng ? engToKor(drug._rawEng) : '';
                drug.name = converted;
                event.target.value = converted;
                this._updateDrugSuggestions(idx, converted);
                return;
            }
        },

        // 한글 IME 또는 숫자 직접 입력 시 (keydown에서 가로채지 않은 입력)
        onDrugInput(idx, event) {
            const value = event.target.value;
            const drug = this.drugs[idx];
            const prev = drug.name;

            // 한글 IME나 숫자 등으로 직접 입력된 경우 영문 버퍼 초기화
            drug._rawEng = '';
            drug.name = value;
            this._updateDrugSuggestions(idx, value);
            if (!value && prev) this.autoDetectOptions();
        },

        _updateDrugSuggestions(idx, value) {
            const drug = this.drugs[idx];
            if (value.length >= 1) {
                drug.suggestions = searchDrugs(value);  // 로컬(311+개인): 즉시
                drug.showSuggestions = true;
                drug.suggestionIdx = -1;
                if (value.length >= 2 && OCR_API_URL) this._backendSearch(idx, value);  // HIRA 22k: 300ms 후
            } else {
                drug.suggestions = [];
                drug.showSuggestions = false;
            }
        },

        _backendSearch(idx, query) {
            if (this._searchTimer) clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(async () => {
                if (!this.drugs[idx] || this.drugs[idx].name !== query) return;
                try {
                    const url = OCR_API_URL.replace(/\/$/, '') + '/api/drug-search?q=' + encodeURIComponent(query) + '&limit=20';
                    const res = await fetch(url);
                    if (!res.ok) return;
                    const out = await res.json();
                    if (!this.drugs[idx] || this.drugs[idx].name !== query) return;
                    const local = this.drugs[idx].suggestions || [];
                    const localCodes = new Set(local.map(d => normCode(d.code)));
                    const newOnes = (out.drugs || [])
                        .filter(d => !localCodes.has(normCode(d.code)))
                        .map(d => ({ code: d.code, name: d.name, price: d.price, note: '', searchName: d.name, _hira: true }));
                    this.drugs[idx].suggestions = local.concat(newOnes).slice(0, 30);
                } catch (e) { /* 무시 */ }
            }, 300);
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
            this.drugs[idx]._rawEng = '';
            // 저장된 coverage 우선 → 개인DB의 coverageType → DB note 기반
            const savedCoverage = lsGet('drugCoverage_', drug.code);
            this.drugs[idx].coverageType = savedCoverage
                || drug.coverageType
                || ((drug.note === '비보험') ? 'nonCovered' : 'insured');
            this.drugs[idx].isIncentive = lsGet('drugIncentive_', drug.code) === '1' || !!drug.isIncentive;
            const isNonCovered = this.drugs[idx].coverageType === 'nonCovered';
            if (isNonCovered) {
                const saved = lsGet('nonCoveredPrice_', drug.code);
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

        // 📷 처방전 사진 → OCR 백엔드 호출 → 약품/나이 자동 채움
        async runOcr(event) {
            const input = event.target;
            const file = input.files && input.files[0];
            if (!file) return;
            if (!OCR_API_URL) {
                this.ocrStatus = '인식 실패: OCR 서버 주소(OCR_API_URL)가 설정되지 않았습니다.';
                input.value = '';
                return;
            }
            this.ocrLoading = true;
            this.ocrStatus = '처방전 분석 중... (5~15초)';
            try {
                const fd = new FormData();
                fd.append('file', file);
                const res = await fetch(OCR_API_URL.replace(/\/$/, '') + '/api/ocr-prescription', {
                    method: 'POST', body: fd
                });
                if (!res.ok) {
                    let detail = res.status;
                    try { detail = (await res.json()).detail || detail; } catch (e) {}
                    throw new Error(detail);
                }
                const data = await res.json();
                await this.applyOcr(data);
                const n = (data.drugs || []).length;
                const unmatched = this.drugs.filter(d => d.name && !d.unitPrice).length;
                this.ocrStatus = `✓ ${n}개 약품 인식${unmatched ? ` · 약가 미확인 ${unmatched}개(직접 확인)` : ''} — 가산조건 확인 후 계산하세요`;
            } catch (err) {
                this.ocrStatus = '인식 실패: ' + (err.message || err);
            } finally {
                this.ocrLoading = false;
                input.value = '';
            }
        },

        // OCR 결과(JSON)를 폼에 반영. 미매칭 약품은 백엔드 HIRA DB에서 자동 조회.
        async applyOcr(data) {
            // 환자 이름 (있으면 자동 채움)
            if (data.patient_name && data.patient_name.trim()) {
                this.patientName = data.patient_name.trim();
            }
            // 가루약조제 표시 → 가루약가산 자동 체크 (6세미만 1~2일분은 recalcAll에서 자동 해제됨)
            this.isPowder = !!data.is_powder;
            // 나이 (주민번호 앞 6자리)
            if (data.birth_6 && /^\d{6}$/.test(data.birth_6)) {
                this.birthDate = data.birth_6;
                this.calculateAge();
            }
            // 발행기관 → 달빛 협약 판별 (베스트아이들병원만 달빛, 그 외 강제 OFF)
            this.issuingHospital = (data.hospital_name || '').trim();
            this.issuingHospitalCode = (data.hospital_code || '').trim();
            if (this.issuingHospital || this.issuingHospitalCode) {
                this.isMoonlight = this.moonlightAllowed;
            }
            // 약품
            const localDb = loadLocalDrugDb();
            const rows = [];
            for (const d of (data.drugs || [])) {
                const row = createEmptyDrug();
                row.name = (d.name || '').trim();
                row.code = (d.code || '').trim();
                row.dosePerTime = d.dose_per_time || null;
                row.timesPerDay = d.times_per_day || null;
                row.totalDays = d.total_days || null;
                // 매칭 순서: 개인DB(코드) → 기본DB(코드 정규화) → 이름 정확 → 이름 부분
                const code9 = normCode(row.code);
                let hit = null;
                let hitNote = '';
                if (code9 && localDb[code9]) {
                    hit = localDb[code9];
                }
                if (!hit && code9) {
                    const dbHit = DRUG_DB.find(x => normCode(x.code) === code9);
                    if (dbHit) { hit = dbHit; hitNote = dbHit.note || ''; }
                }
                if (!hit && row.name) {
                    const exact = DRUG_DB.find(x => x.name === row.name);
                    if (exact) { hit = exact; hitNote = exact.note || ''; }
                    else {
                        const partial = DRUG_DB.find(x => x.name.includes(row.name) || row.name.includes(x.name));
                        if (partial) { hit = partial; hitNote = partial.note || ''; }
                    }
                }
                if (hit) {
                    // 코드를 9자리로 통일
                    row.code = normCode(hit.code) || code9 || row.code;
                    const sc = lsGet('drugCoverage_', row.code);
                    row.coverageType = sc
                        || hit.coverageType
                        || (hitNote === '비보험' ? 'nonCovered' : 'insured');
                    row.isIncentive = lsGet('drugIncentive_', row.code) === '1' || !!hit.isIncentive;
                    if (row.coverageType === 'nonCovered') {
                        const saved = lsGet('nonCoveredPrice_', row.code);
                        row.unitPrice = saved ? Number(saved) : (hit.price || 0);
                    } else {
                        row.unitPrice = hit.price || 0;
                    }
                } else if (code9) {
                    // DB 미매칭이지만 코드 있음 → 사용자가 이전에 저장한 값 복원
                    row.code = code9;
                    const sc = lsGet('drugCoverage_', code9);
                    if (sc) row.coverageType = sc;
                    row.isIncentive = lsGet('drugIncentive_', code9) === '1';
                    const savedPrice = row.coverageType === 'nonCovered'
                        ? lsGet('nonCoveredPrice_', code9) : null;
                    if (savedPrice) row.unitPrice = Number(savedPrice);
                }
                rows.push(row);
            }
            if (rows.length) this.drugs = rows;

            // 미매칭(약가 0 + 코드 있음) → 백엔드 HIRA DB(~22,000개) 조회
            const missed = this.drugs
                .filter(d => d.code && !d.unitPrice)
                .map(d => normCode(d.code))
                .filter(c => c);
            if (missed.length && OCR_API_URL) {
                try {
                    const url = OCR_API_URL.replace(/\/$/, '') + '/api/drug-lookup?codes=' + encodeURIComponent(missed.join(','));
                    const res = await fetch(url);
                    if (res.ok) {
                        const out = await res.json();
                        const found = out.drugs || {};
                        this.drugs.forEach(d => {
                            if (!d.code || d.unitPrice) return;
                            const c9 = normCode(d.code);
                            const hira = found[c9];
                            if (hira) {
                                d.code = c9;
                                if (hira.name) d.name = hira.name;
                                d.unitPrice = hira.price || 0;
                                rememberDrug(d);  // 개인DB에 누적 (다음부턴 즉시)
                            }
                        });
                    }
                } catch (e) {
                    console.warn('HIRA 조회 실패:', e);
                }
            }

            this.drugs.forEach((_, i) => this.recalcDrug(i));
            this.autoDetectOptions();
            this.recalcAll();
        },

        // 통합 약가 변경 핸들러 — 보험/비급여 구분 없이 변경 시 자동 저장 (개인DB 누적)
        onPriceChange(idx) {
            const d = this.drugs[idx];
            const price = parseInt(d.unitPrice) || 0;
            d.unitPrice = price;
            if (d.code) {
                const code9 = normCode(d.code);
                if (d.coverageType === 'nonCovered') {
                    localStorage.setItem('nonCoveredPrice_' + code9, price);
                }
                if (d.name && price > 0) rememberDrug(d);  // 개인DB에 누적
            }
            this.recalcDrug(idx);
        },
        // 호환: 기존 onNonCoveredPriceChange 호출 보존
        onNonCoveredPriceChange(idx) { this.onPriceChange(idx); },

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
            const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
            const patientName = (this.patientName || '').trim();
            const ageStr = (this.age !== null && this.age !== undefined) ? ` (${this.age}세)` : '';
            const nameHtml = patientName ? `<div class="patient-name">${esc(patientName)}${ageStr} 님</div>` : '';

            // 약제비 계산서·영수증 [별지 제11호 서식] — 윤약국 정식 양식
            const won = (n) => (Math.round(n) || 0).toLocaleString() + ' 원';
            const pad = (n) => String(n).padStart(2, '0');
            const ymd = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
            const ymd8 = `${today.getFullYear()}${pad(today.getMonth()+1)}${pad(today.getDate())}`;
            // 영수증번호: YYYYMMDD + 당일 일련번호(4자리), localStorage로 매일 1부터 누적
            const serialKey = 'receiptSerial_' + ymd8;
            let serial = parseInt(localStorage.getItem(serialKey) || '0', 10) + 1;
            try { localStorage.setItem(serialKey, String(serial)); } catch (e) {}
            const receiptNo = ymd8 + String(serial).padStart(4, '0');
            const extra = this.extraPayTotal;                       // ③ 비급여 및 전액본인부담금
            const copay = this.copayAmount;                         // 총수납금액(①+③)
            const insuredCopay = Math.max(0, copay - extra);        // ① 본인부담금
            const gongdan = this.insuranceAmount;                   // ② 보험자부담금
            const grand = this.grandTotal;                          // 약제비총액(①+②+③)
            const days = this.maxDays;
            const hr = this.currentHour;
            const isNight = (hr >= 18 || hr < 9);                    // 야간(시간외)
            const isHolidayDay = (this.dayType === 'holiday');      // 공휴일
            const chk = (on) => on ? '√' : '&nbsp;&nbsp;';
            const receiptHtml = `
  <div class="receipt">
    <div class="r-title">약제비 계산서·영수증 <span class="r-form">[별지 제11호 서식]</span></div>
    <table class="r-grid"><tr>
      <td class="r-col">
        <table class="rt">
          <tr><th>영수증번호</th><td colspan="2">${receiptNo}</td></tr>
          <tr><td colspan="3" class="r-date">${ymd} &nbsp;&nbsp; 야간(${chk(isNight)}) &nbsp; 공휴일(${chk(isHolidayDay)})</td></tr>
          <tr><th>환자성명</th><td colspan="2">${esc(patientName) || '-'}</td></tr>
          <tr><th>투약일수</th><td colspan="2">${days ? days + ' 일' : '-'}</td></tr>
          <tr><th>약제비총액<span class="r-sup">①+②+③</span></th><td colspan="2">${won(grand)}</td></tr>
          <tr><th>본인부담금 ①</th><td colspan="2">${won(insuredCopay)}</td></tr>
          <tr><th>보험자부담금 ②</th><td colspan="2">${won(gongdan)}</td></tr>
        </table>
      </td>
      <td class="r-col">
        <table class="rt">
          <tr><th colspan="2">비급여및전액본인부담금③</th><td>${won(extra)}</td></tr>
          <tr><th rowspan="4" class="r-vlabel">총수납금액<br>(①+③)</th><th>카드</th><td>&nbsp;</td></tr>
          <tr><th>현금영수증</th><td>&nbsp;</td></tr>
          <tr><th>현금</th><td>&nbsp;</td></tr>
          <tr><th>합계</th><td class="r-pay">${won(copay)}</td></tr>
          <tr><th rowspan="2" class="r-vlabel">현금영수증</th><th>신분확인번호</th><td>-</td></tr>
          <tr><th>현금승인번호</th><td>&nbsp;</td></tr>
        </table>
      </td>
      <td class="r-col">
        <table class="rt">
          <tr><th>사업자등록번호</th><td>${esc(PHARMACY_INFO.bizNo)}</td></tr>
          <tr><th>사업자소재지</th><td>${esc(PHARMACY_INFO.address)}</td></tr>
          <tr><th>상호</th><td>${esc(PHARMACY_INFO.name)}</td></tr>
          <tr><th>성명</th><td class="r-stamp-cell">${esc(PHARMACY_INFO.owner)}${STAMP_SVG}</td></tr>
          <tr><th>발행일</th><td>${ymd}</td></tr>
        </table>
      </td>
    </tr></table>
    <div class="r-notes">
      <p>* 이 계산서/영수증은 소득세법상 의료비 또는 조세특례제한법에 의한 현금영수증(현금영수증 번호가 기재된 경우) 공제신청에 사용할 수 있습니다. 다만, 지출증빙용으로 발급된 현금영수증(지출증빙)은 공제신청에 사용할 수 없습니다.</p>
      <p>* 이 계산서 영수증에 대한 세부내역을 요구할 수 있습니다.</p>
      <p>* 전액본인부담금이란 국민건강보험법 시행규칙 별표5의 규정에 의한 요양급여비용의 본인전액부담항목 비용을 말합니다.</p>
    </div>
  </div>`;

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
  .page-header .patient-name { font-size: 14px; font-weight: bold; color: #1d6fad; margin-top: 3px; }
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
  .receipt { margin-top: 6mm; border: 2px solid #1a1a1a; page-break-inside: avoid; }
  .receipt .r-title { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px; padding: 4px 0; border-bottom: 2px solid #1a1a1a; }
  .receipt .r-title .r-form { font-size: 11px; font-weight: bold; letter-spacing: 0; margin-left: 4px; }
  .receipt .r-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .receipt .r-grid > tbody > tr > .r-col { border-right: 2px solid #1a1a1a; padding: 0; vertical-align: top; }
  .receipt .r-grid > tbody > tr > .r-col:last-child { border-right: none; }
  .receipt .r-grid > tbody > tr > .r-col:nth-child(1) { width: 38%; }
  .receipt .r-grid > tbody > tr > .r-col:nth-child(2) { width: 34%; }
  .receipt .r-grid > tbody > tr > .r-col:nth-child(3) { width: 28%; }
  .receipt .rt { width: 100%; height: 100%; border-collapse: collapse; font-size: 10px; }
  .receipt .rt th, .receipt .rt td { border: 0.7px solid #777; padding: 3px 5px; text-align: center; vertical-align: middle; line-height: 1.3; }
  .receipt .rt th { background: #fafafa; color: #222; font-weight: 600; white-space: nowrap; }
  .receipt .rt td { text-align: right; }
  .receipt .r-date { text-align: center !important; font-weight: 600; }
  .receipt .r-sup { font-size: 8px; color: #555; margin-left: 2px; vertical-align: middle; }
  .receipt .r-vlabel { writing-mode: horizontal-tb; white-space: normal; font-size: 9px; }
  .receipt .r-pay { color: #c00; font-weight: bold; font-size: 12px; }
  .receipt .rt .r-col3 td, .receipt .r-grid .r-col:nth-child(3) .rt td { text-align: left; font-size: 9px; }
  .receipt .r-stamp-cell { white-space: nowrap; }
  .receipt .r-seal { display: inline-block; width: 34px; height: 34px; vertical-align: middle; margin-left: 4px; transform: rotate(-7deg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt .r-notes { padding: 4px 8px; font-size: 8.5px; color: #333; line-height: 1.5; border-top: 1px solid #999; }
  .receipt .r-notes p { margin: 1px 0; }
  .page-footer { margin-top: 5mm; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #ccc; padding-top: 2mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="page-header">
    <h1>복 약 안 내 문</h1>
    ${nameHtml}
    <div class="sub">${esc(PHARMACY_INFO.name)} &nbsp;|&nbsp; 발행일: ${dateStr} &nbsp;|&nbsp; 총 ${activeDrugs.length}가지 약품</div>
  </div>
  <div class="grid">${cards}</div>
  ${receiptHtml}
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

        clearAllDrugs() {
            this.drugs = [createEmptyDrug()];
            this.autoDetectOptions();
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
            const hasTopical = categories.includes('topical');          // 진짜 외용제(크림·연고·패치·점안 등)
            const hasInjection = categories.includes('injection');      // 약국조제 주사제
            const hasSelfInj = categories.includes('self_injection');   // 자가투여주사

            if (!hasOral && hasTopical && !hasInjection) {
                // 외용제만 (자가주사 동반해도 단독 F로 동일 처리)
                this.topicalOnly = true;
                this.injectionOnly = false;
                this.hasTopical = false;
            } else if (!hasOral && !hasTopical && hasSelfInj && !hasInjection) {
                // 자가주사제만 단독 → 자가투여주사 조제료(F, 외용단일과 동일)
                this.topicalOnly = true;
                this.injectionOnly = false;
                this.hasTopical = false;
            } else if (!hasOral && !hasTopical && !hasSelfInj && hasInjection) {
                // 약국조제 주사제만
                this.injectionOnly = true;
                this.topicalOnly = false;
                this.hasTopical = false;
            } else if (hasOral && hasTopical) {
                // 내복약 + 외용제 → 외용제 포함(H가산). 자가주사가 끼어도 자가주사분은 미가산
                this.hasTopical = true;
                this.topicalOnly = false;
                this.injectionOnly = false;
            } else {
                // 내복약만, 또는 내복약+자가주사(자가주사 미가산) 등
                this.hasTopical = false;
                this.topicalOnly = false;
                this.injectionOnly = false;
            }

            this.recalcAll();
        },

        recalcAll() {
            // 만6세미만 + 1~2일분 → 가루약가산 자동 해제
            if (this.age !== null && this.age < 6 && this.maxDays > 0 && this.maxDays <= 2) {
                if (this.isPowder) this.isPowder = false;
            }

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
            this.patientName = '';
            this.birthDate = '';
            this.age = null;
            this.ocrStatus = '';
            this.issuingHospital = '';
            this.issuingHospitalCode = '';
            this.isPremature = false;
            this.insuranceType = 'health';
            this.isMoonlight = false;
            this.isNonFaceToFace = false;
            this.noDispensingFee = false;
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
