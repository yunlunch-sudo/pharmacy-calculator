#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
처방 약값 대조 엔진
====================
처방 내역(+나이)으로 약값을 계산하고, 약국 프로그램이 계산한 값과 대조하여
어느 항목에서 차이가 나는지 분해해서 보여준다.

입력: JSON (파일 경로 인자 / stdin / 인라인 문자열)
출력: 계산 내역 + (program 값이 있으면) 항목별 차이 분석

JS 원본 로직 포팅:
- web/js/fee_table.js   → FEE_TABLE / 상수
- web/js/calculator.js  → calculate()  (처방조제료)
- web/js/app.js         → 약품비 / 약값총액 / 본인부담금
"""
import json
import math
import os
import sys

# ─────────────────────────────────────────────────────────────
# 1. 점수표 / 상수  (fee_table.js)
# ─────────────────────────────────────────────────────────────
CONVERSION_INDEX = 105.5      # 환산지수 (원/점)
NON_FACE_TO_FACE_FEE = 1100   # 비대면 시범사업관리료 (고정)
PEDIATRIC_EXTRA = 6.67        # 소아가산 추가 점수

DAYS_RANGES = [
    (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7),
    (8, 8), (9, 9), (10, 10), (11, 11), (12, 12), (13, 13),
    (14, 14), (15, 15), (16, 20), (21, 25), (26, 30),
    (31, 40), (41, 50), (51, 60), (61, 70), (71, 80), (81, 90), (91, 999),
]


def get_days_key(days):
    for low, high in DAYS_RANGES:
        if low <= days <= high:
            if low == high:
                return str(low)
            if high == 999:
                return "91이상"
            return f"{low}~{high}"
    raise ValueError(f"유효하지 않은 투약일수: {days}")


def _row(d):
    return {"A": 7.45, "B": 16.26, "C": 10.94, "D": d[0], "Da": d[1],
            "E": 6.42, "Ea": 9.04, "F": 16.20, "G": 5.45, "H": 3.01, "I": 40.85}


FEE_TABLE = {
    "1":      _row((17.20, 5.16)),
    "2":      _row((19.39, 5.82)),
    "3":      _row((25.45, 7.64)),
    "4":      _row((28.73, 8.62)),
    "5":      _row((32.81, 9.84)),
    "6":      _row((36.08, 10.82)),
    "7":      _row((40.97, 12.29)),
    "8":      _row((43.09, 12.93)),
    "9":      _row((45.69, 13.71)),
    "10":     _row((49.42, 14.83)),
    "11":     _row((52.32, 15.70)),
    "12":     _row((55.21, 16.56)),
    "13":     _row((58.11, 17.43)),
    "14":     _row((67.46, 20.24)),
    "15":     _row((68.74, 20.62)),
    "16~20":  _row((76.65, 23.00)),
    "21~25":  _row((80.52, 24.16)),
    "26~30":  _row((95.69, 28.71)),
    "31~40":  _row((107.04, 32.11)),
    "41~50":  _row((115.97, 34.79)),
    "51~60":  _row((139.42, 41.83)),
    "61~70":  _row((144.32, 43.30)),
    "71~80":  _row((148.57, 44.57)),
    "81~90":  _row((152.82, 45.85)),
    "91이상": _row((157.82, 47.35)),
}

ITEM_NAMES = {
    "A": "약국관리료", "B": "조제기본료", "C": "복약지도료", "D": "조제료",
    "Da": "조제료(가루)", "E": "의약품관리료", "Ea": "의약품관리료(마약)",
    "F": "외용조제료", "G": "주사제조제료", "H": "주사제/외용제가산",
    "I": "달빛가산", "소아": "소아가산",
}


def round_to_10(amount):
    # JS Math.round = 4사5입(.5는 올림). 음수 미발생 가정.
    return math.floor(amount / 10 + 0.5) * 10


def item_won(base_score, multiplier, ci):
    return round_to_10(base_score * multiplier * ci)


# ─────────────────────────────────────────────────────────────
# 2. 처방조제료 계산  (calculator.js)
# ─────────────────────────────────────────────────────────────
def calculate_fee(inp):
    g = lambda k, d=False: inp.get(k, d)
    days = inp["days"]
    age = inp["age"]
    hour = inp["hour"]

    result = {"items": [], "conversionIndex": CONVERSION_INDEX,
              "dispensingFee": 0, "nonFaceToFaceFee": 0, "totalFee": 0,
              "appliedConditions": []}

    scores = FEE_TABLE[get_days_key(days)]

    is_pediatric = age < 6
    is_under18 = age <= 18
    is_night = not (9 <= hour < 18)
    is_ped_late = is_pediatric and hour >= 20
    is_holiday = g("isHoliday") or g("isSaturday")

    cond = result["appliedConditions"]

    # 1. 배수 결정
    if g("isNonFaceToFace"):
        bc_mult = d_mult = 1.0
        cond.append("비대면 조제 → 가산 미적용")
    elif is_ped_late:
        bc_mult, d_mult = 3.0, 2.0
        cond.append(f"소아심야가산 (6세미만 + {hour}시) → B,C×3 / D×2")
    elif is_holiday or is_night:
        bc_mult = d_mult = 1.3
        cond.append("휴일가산 (토/일/공휴일) → (B+C+D)×1.3" if is_holiday
                    else f"시간외가산 ({hour}시) → (B+C+D)×1.3")
    else:
        bc_mult = d_mult = 1.0
        cond.append("평일 주간 (09~18시) → 가산 없음")

    # 2. 소아 / 가루약 가산 결정
    apply_ped = apply_powder = False
    eff_powder_days = g("powderDays", 0) if g("powderDays", 0) > 0 else days
    powder_scores = FEE_TABLE[get_days_key(eff_powder_days)]

    if is_pediatric and g("isPowder") and not g("isNonFaceToFace"):
        da = powder_scores["Da"]
        if is_ped_late:
            apply_ped = True
            cond.append(f"소아심야+가루약 → 소아가산 강제 (+{PEDIATRIC_EXTRA}, Da 미적용)")
        elif PEDIATRIC_EXTRA >= da:
            apply_ped = True
            cond.append(f"소아+가루약 → 소아가산 선택 (+{PEDIATRIC_EXTRA} > Da {da})")
        else:
            apply_powder = True
            cond.append(f"소아+가루약 → 가루약가산 선택 (Da {da} > +{PEDIATRIC_EXTRA})")
    elif is_pediatric and not g("isNonFaceToFace"):
        apply_ped = True
        cond.append(f"소아가산 (6세미만) → B+{PEDIATRIC_EXTRA}")
    elif g("isPowder"):
        apply_powder = True
        cond.append(f"가루약가산 → +Da({powder_scores['Da']})")

    push = lambda code, base, mult: result["items"].append(
        {"code": code, "name": ITEM_NAMES[code], "baseScore": base, "multiplier": mult})

    # 3. 항목 계산
    push("A", scores["A"], 1.0)
    push("B", scores["B"], bc_mult)
    if apply_ped:
        push("소아", PEDIATRIC_EXTRA, 1.0)
    push("C", scores["C"], bc_mult)

    if g("topicalOnly"):
        d_code, d_score = "F", scores["F"]
        cond.append("외용제 단일 (내복약 없음)")
    elif g("injectionOnly"):
        d_code, d_score = "G", scores["G"]
        cond.append("주사제 단일 (내복약 없음)")
    else:
        d_code, d_score = "D", scores["D"]
    push(d_code, d_score, d_mult)

    if g("hasNarcotic"):
        push("Ea", scores["Ea"], 1.0)
    else:
        push("E", scores["E"], 1.0)

    if apply_powder and not g("topicalOnly") and not g("injectionOnly"):
        push("Da", powder_scores["Da"], 1.0)

    if not g("topicalOnly") and not g("injectionOnly"):
        if g("hasTopical") or g("hasInjection"):
            push("H", scores["H"] * 2, d_mult)  # 3.01 × 2

    if g("isMoonlightPharmacy") and is_under18 and not g("isNonFaceToFace"):
        if is_holiday or hour >= 18:
            push("I", scores["I"], 1.0)
            cond.append("달빛가산 적용")

    # 4. 합산
    ci = result["conversionIndex"]
    for it in result["items"]:
        it["won"] = item_won(it["baseScore"], it["multiplier"], ci)
    result["dispensingFee"] = sum(it["won"] for it in result["items"])

    if g("isNonFaceToFace"):
        result["nonFaceToFaceFee"] = NON_FACE_TO_FACE_FEE
        cond.append(f"비대면 시범사업관리료 +{NON_FACE_TO_FACE_FEE:,}원")

    result["totalFee"] = result["dispensingFee"] + result["nonFaceToFaceFee"]
    return result


# ─────────────────────────────────────────────────────────────
# 3. 약품비 / 약값총액 / 본인부담금  (app.js)
# ─────────────────────────────────────────────────────────────
_DRUG_DB = None


def _load_drug_db():
    """drugs.json → {code: price, name: price} 룩업 테이블."""
    global _DRUG_DB
    if _DRUG_DB is not None:
        return _DRUG_DB
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "web", "data", "drugs.json")
    by_code, by_name = {}, {}
    try:
        with open(path, encoding="utf-8") as f:
            for d in json.load(f):
                by_code[d["code"]] = d
                by_name[d["name"]] = d
    except FileNotFoundError:
        pass
    _DRUG_DB = (by_code, by_name)
    return _DRUG_DB


def resolve_unit_price(drug):
    """약가 미입력 시 drugs.json에서 코드→이름 순으로 조회."""
    if drug.get("unitPrice") is not None:
        return int(drug["unitPrice"]), "입력값"
    by_code, by_name = _load_drug_db()
    code = str(drug.get("code", "")).strip()
    if code and code in by_code:
        return int(by_code[code]["price"]), "DB(코드)"
    name = drug.get("name", "").strip()
    if name and name in by_name:
        return int(by_name[name]["price"]), "DB(이름)"
    # 부분 일치
    if name:
        for n, d in by_name.items():
            if name in n or n in name:
                return int(d["price"]), f"DB(유사:{n})"
    return 0, "미조회"


def compute_drug_costs(drugs):
    """각 약 amount = round(unitPrice × totalQty). 급여유형별 분리."""
    rows = []
    for drug in drugs:
        unit, src = resolve_unit_price(drug)
        qty = drug.get("qty")
        if qty is None:
            qty = round((drug.get("dosePerTime", 0) or 0)
                        * (drug.get("timesPerDay", 0) or 0)
                        * (drug.get("totalDays", 0) or 0), 2)
        amount = round(unit * qty)
        rows.append({
            "name": drug.get("name", ""),
            "code": drug.get("code", ""),
            "coverage": drug.get("coverage", "insured"),
            "incentive": bool(drug.get("incentive", False)),  # 저가인센티브(저가약) 여부
            "days": drug.get("days", drug.get("totalDays")),  # 약품별 투약일수 (본인부담 그룹핑용)
            "unitPrice": unit, "priceSource": src,
            "qty": qty, "amount": amount,
        })
    return rows


def compute_copay(main_group_sums, insured_incentive, fee_insured, full_pay, non_covered,
                  insured_total, grand_total, fee_total_raw, no_dispensing_fee,
                  insurance_type, age, is_premature):
    """본인부담금 — 약국 프로그램 방식.

    정률 본인부담은 조제료분·일반약가분(투약일수 그룹별)·저가인센티브분을 **각각**
    본인부담률 적용 후 100원 올림하여 합산한다 (총액 한 번에 계산하지 않음).
      예) 조제료 11,570×20%=2,314 → 2,400,
          내복5일 12,526×20%=2,505 → 2,600, 점안1일 3,289×20%=658 → 700,
          저가인센티브 5×20%=1 → 100
    `main_group_sums`는 일반(인센 제외) 급여약가를 투약일수별로 묶은 합 목록.
    `insured_incentive`는 저가인센티브 약가 합 (별도 100원 올림 대상).
    """
    insured_main = sum(main_group_sums)
    non_covered_fee = (fee_total_raw if (not no_dispensing_fee and non_covered > 0
                                         and insured_main == 0 and insured_incentive == 0
                                         and full_pay == 0) else 0)
    extra_pay = full_pay + non_covered + non_covered_fee

    if insurance_type in ("auto", "industrial", "etc"):
        labels = {"auto": "자동차보험", "industrial": "산재보험", "etc": "기타"}
        return {"amount": grand_total, "desc": labels[insurance_type] + " → 100%"}

    # 끝수처리(100원 단위) — 실측 확정 (10개 케이스 일치):
    #   6세미만(조산아 제외): 조제료·약가·인센 모두 올림(ceil)
    #   그 외(성인·65세·조산아): 조제료분은 내림(floor), 약가·인센분은 반올림(4사5입)
    #   결정 케이스: 달빛 11세 조제료 14,640×30%=4,392 → 내림 4,300 (반올림이면 4,400, 프로그램 7,700)
    if age is not None and age < 6 and not is_premature:
        r_fee = lambda x: math.ceil(x / 100) * 100
        r_drug = lambda x: math.ceil(x / 100) * 100
    else:
        r_fee = lambda x: math.floor(x / 100) * 100             # 조제료분 내림
        r_drug = lambda x: math.floor(x / 100 + 0.5) * 100      # 약가·인센분 반올림(4사5입)

    # 정률: 조제료분 + 일반약가분(투약일수 그룹별) + 저가인센티브분 각각 끝수처리 후 합산
    def pct(rate):
        fee_part = r_fee(fee_insured * rate)
        drug_part = sum(r_drug(g * rate) for g in main_group_sums)
        inc_part = r_drug(insured_incentive * rate)
        return fee_part + drug_part + inc_part

    insured = insured_total
    if insurance_type == "subHealth":
        copay, desc = (500 if insured > 0 else 0), "차상위 → 500원"
    elif insurance_type == "medical1":
        copay, desc = 0, "의료급여 1종 → 0원"
    elif insurance_type == "medical2":
        copay, desc = (500 if insured > 0 else 0), "의료급여 2종 → 500원"
    else:
        if is_premature:
            # 조산아(F016) 5%: 항목별 반올림 (성인과 동일 끝수처리). 2세 700 / 4세 1,400 일치
            copay, desc = pct(0.05), "조산아 F016 → 5%"
        elif age is not None and age >= 65:
            if insured <= 10000:
                copay = 1000 if insured > 0 else 0
                desc = "65세이상 / 1만원이하 → 정액 1,000원"
            elif insured <= 12000:
                copay, desc = pct(0.2), "65세이상 / 1~1.2만원 → 20%"
            else:
                copay, desc = pct(0.3), "65세이상 / 1.2만원초과 → 30%"
        elif age is not None and age < 6:
            copay, desc = pct(0.2), "6세미만 → 20%"
        else:
            copay, desc = pct(0.3), "일반 → 30%"

    total = copay + extra_pay
    if extra_pay > 0:
        desc += f" + 비보험 {extra_pay:,}원"
    return {"amount": total, "desc": desc}


# ─────────────────────────────────────────────────────────────
# 4. 종합 계산 + 대조
# ─────────────────────────────────────────────────────────────
def compute(data):
    rx = data["rx"]
    drugs = data.get("drugs", [])
    no_fee = rx.get("noDispensingFee", False)

    fee = calculate_fee(rx)
    fee_total = 0 if no_fee else fee["totalFee"]

    drug_rows = compute_drug_costs(drugs)

    is_ins = lambda r: r["coverage"] == "insured"
    insured_inc_raw = sum(r["amount"] for r in drug_rows if is_ins(r) and r["incentive"])
    insured_main_raw = sum(r["amount"] for r in drug_rows if is_ins(r) and not r["incentive"])
    full_pay = sum(r["amount"] for r in drug_rows if r["coverage"] == "fullPay")
    non_covered = sum(r["amount"] for r in drug_rows if r["coverage"] == "nonCovered")

    # 일반(인센 제외) 보험약을 투약일수별로 그룹핑 → 본인부담 약품비분은 그룹별 100원 올림
    main_groups = {}
    for r in drug_rows:
        if is_ins(r) and not r["incentive"]:
            main_groups[r["days"]] = main_groups.get(r["days"], 0) + r["amount"]
    main_group_sums = list(main_groups.values())

    # 약가합계 10원 절사 (약국 프로그램 청구 기준: 급여 약품비 원단위 버림. 인센티브 포함)
    insured_drug = ((insured_main_raw + insured_inc_raw) // 10) * 10
    drug_total = insured_drug + full_pay + non_covered

    grand_total = drug_total + fee_total

    has_insured = any((r["name"] or r["amount"]) and r["coverage"] in ("insured", "fullPay")
                      for r in drug_rows)
    fee_insured = fee_total if has_insured else 0
    insured_total = 0 if no_fee else (insured_drug + fee_insured if has_insured else 0)

    copay = compute_copay(
        main_group_sums, insured_inc_raw, fee_insured, full_pay, non_covered,
        insured_total, grand_total, fee["totalFee"], no_fee,
        rx.get("insuranceType", "health"), rx.get("age"), rx.get("isPremature", False))

    return {
        "fee": fee, "feeTotal": fee_total,
        "drugRows": drug_rows, "drugTotal": drug_total,
        "insuredTotal": insured_total,
        "grandTotal": grand_total,
        "copay": copay["amount"], "copayDesc": copay["desc"],
        "insuranceClaim": grand_total - copay["amount"],
    }


# 약국 프로그램 항목명 → 내부 키
_FIELD_LABELS = [
    ("copay", "환자 본인부담금"),
    ("dispensingFee", "처방조제료"),
    ("drugTotal", "약품비 총액"),
    ("grandTotal", "약값 총액"),
]


def reconcile(result, program):
    """program(약국 프로그램 값)과 비교한 차이 목록."""
    mine = {
        "copay": result["copay"],
        "dispensingFee": result["feeTotal"],
        "drugTotal": result["drugTotal"],
        "grandTotal": result["grandTotal"],
    }
    diffs = []
    for key, label in _FIELD_LABELS:
        if key not in program or program[key] is None:
            continue
        prog = int(program[key])
        calc = mine[key]
        diffs.append({"key": key, "label": label, "mine": calc,
                      "program": prog, "diff": calc - prog})
    return diffs


# ─────────────────────────────────────────────────────────────
# 5. 출력
# ─────────────────────────────────────────────────────────────
def won(n):
    return f"₩{n:,}"


def render(data, result):
    out = []
    rx = data["rx"]
    out.append("━" * 52)
    out.append("  처방 약값 계산 결과")
    out.append("━" * 52)
    out.append(f"  나이 {rx['age']}세 · {rx['days']}일분 · {rx['hour']}시 · 보험:{rx.get('insuranceType','health')}")
    out.append("")

    # 처방조제료 내역
    out.append("【 처방조제료 】")
    for it in result["fee"]["items"]:
        m = f"×{it['multiplier']}" if it["multiplier"] != 1.0 else ""
        out.append(f"  {it['code']:<4}{it['name']:<14} {it['baseScore']:>7.2f}점 {m:<6} = {won(it['won'])}")
    if result["fee"]["nonFaceToFaceFee"]:
        out.append(f"  {'비대면':<4}{'시범사업관리료':<14} {'':>7} {'':<6} = {won(result['fee']['nonFaceToFaceFee'])}")
    out.append(f"  {'─'*44}")
    out.append(f"  ▶ 처방조제료 합계: {won(result['feeTotal'])}")
    for c in result["fee"]["appliedConditions"]:
        out.append(f"     · {c}")
    out.append("")

    # 약품비
    if result["drugRows"]:
        out.append("【 약품비 】")
        for r in result["drugRows"]:
            cov = {"insured": "보험", "fullPay": "100/100", "nonCovered": "비급여"}.get(r["coverage"], r["coverage"])
            if r["incentive"]:
                cov += "·인센"
            out.append(f"  {r['name'][:24]:<24} {won(r['unitPrice'])}×{r['qty']} = {won(r['amount'])}  [{cov}/{r['priceSource']}]")
        out.append(f"  {'─'*44}")
        out.append(f"  ▶ 약품비 총액: {won(result['drugTotal'])}")
        out.append("")

    # 최종
    out.append("【 최종 】")
    out.append(f"  약값 총액(조제료+약품비): {won(result['grandTotal'])}")
    out.append(f"  환자 본인부담금: {won(result['copay'])}   ({result['copayDesc']})")
    out.append(f"  공단 청구액: {won(result['insuranceClaim'])}")
    out.append("")

    # 대조
    program = data.get("program")
    if program:
        diffs = reconcile(result, program)
        out.append("━" * 52)
        out.append("  약국 프로그램 값과 대조")
        out.append("━" * 52)
        out.append(f"  {'항목':<16}{'내 계산':>12}{'프로그램':>12}{'차이':>10}")
        out.append(f"  {'─'*48}")
        any_diff = False
        for d in diffs:
            mark = "  ✅" if d["diff"] == 0 else "  ⚠️"
            sign = f"+{d['diff']:,}" if d["diff"] > 0 else f"{d['diff']:,}"
            out.append(f"  {d['label']:<16}{won(d['mine']):>12}{won(d['program']):>12}{sign:>10}{mark}")
            if d["diff"] != 0:
                any_diff = True
        out.append("")
        if not any_diff:
            out.append("  ✅ 모든 항목 일치 — 약국 프로그램과 차이 없음")
        else:
            out.append("  ⚠️ 차이 발생 — 아래 진단 참고:")
            out += diagnose(diffs, result, rx)
    out.append("━" * 52)
    return "\n".join(out)


def diagnose(diffs, result, rx):
    """차이 원인 추정 힌트."""
    tips = []
    dmap = {d["key"]: d for d in diffs}

    fee_d = dmap.get("dispensingFee")
    drug_d = dmap.get("drugTotal")
    grand_d = dmap.get("grandTotal")
    copay_d = dmap.get("copay")

    if fee_d and fee_d["diff"] != 0:
        tips.append(f"  · 처방조제료가 {abs(fee_d['diff']):,}원 {'많음' if fee_d['diff']>0 else '적음'} → "
                    "투약일수/가산조건(휴일·시간외·소아·달빛)·외용/마약 플래그 재확인")
        tips.append("    (조제료 항목별 점수는 위 【처방조제료】 내역과 프로그램 수가내역을 한 줄씩 대조)")
    if drug_d and drug_d["diff"] != 0:
        tips.append(f"  · 약품비가 {abs(drug_d['diff']):,}원 {'많음' if drug_d['diff']>0 else '적음'} → "
                    "약가(상한금액)·수량(1회×횟수×일수)·급여유형(보험/비급여) 재확인")
    if grand_d and grand_d["diff"] != 0 and not (fee_d and fee_d["diff"]) and not (drug_d and drug_d["diff"]):
        tips.append("  · 조제료·약품비는 맞는데 약값총액만 다름 → 비급여/100분의100 합산방식 확인")
    if copay_d and copay_d["diff"] != 0:
        tips.append(f"  · 본인부담금이 {abs(copay_d['diff']):,}원 {'많음' if copay_d['diff']>0 else '적음'} → "
                    f"본인부담률/연령구간/반올림(100원올림) 확인 (적용: {result['copayDesc']})")
        if (not (fee_d and fee_d['diff'])) and (not (drug_d and drug_d['diff'])):
            tips.append("    조제료·약품비는 일치하므로 차이는 본인부담률 산정 단계에서 발생")
    if not tips:
        tips.append("  · 차이 원인 미상 — 입력값 점검 필요")
    return tips


def main():
    raw = None
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        cand = args[0]
        if os.path.isfile(cand):
            with open(cand, encoding="utf-8") as f:
                raw = f.read()
        else:
            raw = cand
    else:
        raw = sys.stdin.read()

    data = json.loads(raw)
    result = compute(data)

    if "--json" in sys.argv:
        program = data.get("program")
        payload = {"result": result}
        if program:
            payload["diffs"] = reconcile(result, program)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render(data, result))


if __name__ == "__main__":
    main()
