/**
 * 처방조제료 계산기 (Python calculator.py → JS 포팅)
 * 22개 검증 케이스 통과 확인 필요
 */

function roundTo10(amount) {
    return Math.round(amount / 10) * 10;
}

function itemWon(baseScore, multiplier, ci) {
    return roundTo10(baseScore * multiplier * ci);
}

function calculate(inp) {
    const result = {
        items: [],
        totalScore: 0,
        conversionIndex: CONVERSION_INDEX,
        dispensingFee: 0,
        nonFaceToFaceFee: 0,
        totalFee: 0,
        appliedConditions: [],
    };

    const daysKey = getDaysKey(inp.days);
    const scores = FEE_TABLE[daysKey];

    const isPediatric = inp.age < 6;
    const isUnder18 = inp.age <= 18;
    const isNight = !(inp.hour >= 9 && inp.hour < 18);
    const isPediatricLateNight = isPediatric && inp.hour >= 20;
    const isHoliday = inp.isHoliday || inp.isSaturday;

    // === 1: 배수 결정 ===
    let bcMultiplier, dMultiplier;

    if (inp.isNonFaceToFace) {
        bcMultiplier = 1.0;
        dMultiplier = 1.0;
        result.appliedConditions.push("비대면 조제 -> 가산 미적용");
    } else if (isPediatricLateNight) {
        bcMultiplier = 3.0;
        dMultiplier = 2.0;
        result.appliedConditions.push(`소아심야가산 (6세미만 + ${inp.hour}시) -> B,C x3 / D x2`);
    } else if (isHoliday || isNight) {
        bcMultiplier = 1.3;
        dMultiplier = 1.3;
        if (isHoliday) {
            result.appliedConditions.push("휴일가산 (토/일/공휴일) -> (B+C+D) x1.3");
        } else {
            result.appliedConditions.push(`시간외가산 (${inp.hour}시) -> (B+C+D) x1.3`);
        }
    } else {
        bcMultiplier = 1.0;
        dMultiplier = 1.0;
        result.appliedConditions.push("평일 주간 (09~18시) -> 가산 없음");
    }

    // === 2: 소아/가루약 가산 결정 ===
    let applyPediatric = false;
    let applyPowder = false;

    const effectivePowderDays = inp.powderDays > 0 ? inp.powderDays : inp.days;
    const powderScores = FEE_TABLE[getDaysKey(effectivePowderDays)];

    if (isPediatric && inp.isPowder && !inp.isNonFaceToFace) {
        const daScore = powderScores.Da;
        if (isPediatricLateNight) {
            applyPediatric = true;
            result.appliedConditions.push(`소아심야+가루약 -> 소아가산 강제 (+${PEDIATRIC_EXTRA}, Da 미적용)`);
        } else if (PEDIATRIC_EXTRA >= daScore) {
            applyPediatric = true;
            result.appliedConditions.push(`소아+가루약 -> 소아가산 선택 (+${PEDIATRIC_EXTRA} > Da ${daScore})`);
        } else {
            applyPowder = true;
            result.appliedConditions.push(`소아+가루약 -> 가루약가산 선택 (Da ${daScore} > +${PEDIATRIC_EXTRA})`);
        }
    } else if (isPediatric && !inp.isNonFaceToFace) {
        applyPediatric = true;
        result.appliedConditions.push(`소아가산 (6세미만) -> B+${PEDIATRIC_EXTRA}`);
    } else if (inp.isPowder) {
        applyPowder = true;
        result.appliedConditions.push(`가루약가산 -> +Da(${powderScores.Da})`);
    }

    // === 3: 각 항목 계산 ===

    // A: 약국관리료 (고정)
    result.items.push({
        code: "A", name: ITEM_NAMES.A,
        baseScore: scores.A, multiplier: 1.0,
    });

    // B: 조제기본료
    result.items.push({
        code: "B", name: ITEM_NAMES.B,
        baseScore: scores.B, multiplier: bcMultiplier,
    });

    // 소아가산: 별도 항목 (배수 미적용)
    if (applyPediatric) {
        result.items.push({
            code: "소아", name: ITEM_NAMES["소아"],
            baseScore: PEDIATRIC_EXTRA, multiplier: 1.0,
        });
    }

    // C: 복약지도료
    result.items.push({
        code: "C", name: ITEM_NAMES.C,
        baseScore: scores.C, multiplier: bcMultiplier,
    });

    // D (또는 F/G): 조제료
    let dCode, dScore;
    if (inp.topicalOnly) {
        dCode = "F"; dScore = scores.F;
        result.appliedConditions.push("외용제 단일 (내복약 없음)");
    } else if (inp.injectionOnly) {
        dCode = "G"; dScore = scores.G;
        result.appliedConditions.push("주사제 단일 (내복약 없음)");
    } else {
        dCode = "D"; dScore = scores.D;
    }

    result.items.push({
        code: dCode, name: ITEM_NAMES[dCode],
        baseScore: dScore, multiplier: dMultiplier,
    });

    // E/Ea: 의약품관리료
    if (inp.hasNarcotic) {
        result.items.push({
            code: "Ea", name: ITEM_NAMES.Ea,
            baseScore: scores.Ea, multiplier: 1.0,
        });
    } else {
        result.items.push({
            code: "E", name: ITEM_NAMES.E,
            baseScore: scores.E, multiplier: 1.0,
        });
    }

    // Da: 가루약 추가
    if (applyPowder && !inp.topicalOnly && !inp.injectionOnly) {
        result.items.push({
            code: "Da", name: ITEM_NAMES.Da,
            baseScore: powderScores.Da, multiplier: 1.0,
        });
    }

    // H: 주사제/외용제 가산료
    if (!inp.topicalOnly && !inp.injectionOnly) {
        if (inp.hasTopical || inp.hasInjection) {
            const hBase = scores.H * 2; // 3.01 x 2 = 6.02
            result.items.push({
                code: "H", name: ITEM_NAMES.H,
                baseScore: hBase, multiplier: dMultiplier,
            });
        }
    }

    // I: 달빛가산
    if (inp.isMoonlightPharmacy && isUnder18 && !inp.isNonFaceToFace) {
        let moonlightEligible = false;
        if (isHoliday) {
            moonlightEligible = true;
        } else if (inp.hour >= 18) {
            moonlightEligible = true;
        }
        if (moonlightEligible) {
            result.items.push({
                code: "I", name: ITEM_NAMES.I,
                baseScore: scores.I, multiplier: 1.0,
            });
            result.appliedConditions.push("달빛가산 적용");
        }
    }

    // === 4: 합산 ===
    const ci = result.conversionIndex;
    result.dispensingFee = result.items.reduce(
        (sum, item) => sum + itemWon(item.baseScore, item.multiplier, ci), 0
    );

    if (inp.isNonFaceToFace) {
        result.nonFaceToFaceFee = NON_FACE_TO_FACE_FEE;
        result.appliedConditions.push(`비대면 시범사업관리료 +${NON_FACE_TO_FACE_FEE.toLocaleString()}원`);
    }

    result.totalFee = result.dispensingFee + result.nonFaceToFaceFee;

    return result;
}
