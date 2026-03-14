/**
 * 영타 → 한타 자동 변환 (English QWERTY → Korean 두벌식)
 * Windows에서 영문 입력 상태로 타이핑해도 한글로 자동 변환
 */

const ENG_KEY_MAP = {
    'r':'ㄱ','R':'ㄲ','s':'ㄴ','e':'ㄷ','E':'ㄸ','f':'ㄹ','a':'ㅁ','q':'ㅂ','Q':'ㅃ',
    't':'ㅅ','T':'ㅆ','d':'ㅇ','w':'ㅈ','W':'ㅉ','c':'ㅊ','z':'ㅋ','x':'ㅌ','v':'ㅍ','g':'ㅎ',
    'k':'ㅏ','o':'ㅐ','i':'ㅑ','O':'ㅒ','j':'ㅓ','p':'ㅔ','u':'ㅕ','P':'ㅖ',
    'h':'ㅗ','y':'ㅛ','n':'ㅜ','b':'ㅠ','m':'ㅡ','l':'ㅣ'
};

// 초성 목록 (19개)
const CHO_LIST = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
// 중성 목록 (21개)
const JUNG_LIST = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
// 종성 목록 (28개, 첫번째는 종성없음)
const JONG_LIST = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 복합 중성 조합
const COMPOUND_JUNG = {
    'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ',
    'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ',
    'ㅡㅣ':'ㅢ'
};

// 복합 종성 조합
const COMPOUND_JONG = {
    'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ',
    'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ', 'ㄹㅂ':'ㄼ', 'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ',
    'ㅂㅅ':'ㅄ'
};

// 복합 종성 분리 (종성이 다음 초성으로 넘어갈 때)
const DECOMPOSE_JONG = {};
for (const [pair, compound] of Object.entries(COMPOUND_JONG)) {
    DECOMPOSE_JONG[compound] = [pair[0], pair[1]];
}

function isConsonant(ch) { return CHO_LIST.includes(ch); }
function isVowel(ch) { return JUNG_LIST.includes(ch); }

/**
 * 영문 QWERTY 입력을 한글로 변환
 * @param {string} str - 영문으로 입력된 문자열
 * @returns {string} 한글로 변환된 문자열
 */
function engToKor(str) {
    // 영문 알파벳이 없으면 변환 불요
    if (!/[a-zA-Z]/.test(str)) return str;

    // 1단계: 각 영문자를 한글 자모로 변환 (영문 키에 해당하지 않는 문자는 그대로)
    const jamo = [];
    for (const ch of str) {
        jamo.push(ENG_KEY_MAP[ch] || ch);
    }

    // 2단계: 자모를 조합하여 완성형 한글로
    return assembleHangul(jamo);
}

/**
 * 자모 배열을 완성형 한글 문자열로 조합
 */
function assembleHangul(jamo) {
    const result = [];
    let i = 0;

    while (i < jamo.length) {
        const cur = jamo[i];

        // 자음이 아니면 (모음 단독이거나 기타 문자) 그대로 출력
        if (!isConsonant(cur)) {
            result.push(cur);
            i++;
            continue;
        }

        // 초성 자음 발견
        const cho = CHO_LIST.indexOf(cur);
        if (cho === -1) { result.push(cur); i++; continue; }

        // 다음 글자가 모음인지 확인
        if (i + 1 >= jamo.length || !isVowel(jamo[i + 1])) {
            // 모음이 없으면 자음만 출력
            result.push(cur);
            i++;
            continue;
        }

        // 중성 처리 (복합 모음 확인)
        let jungChar = jamo[i + 1];
        let jungConsumed = 2; // cho + jung

        if (i + 2 < jamo.length && isVowel(jamo[i + 2])) {
            const compound = COMPOUND_JUNG[jungChar + jamo[i + 2]];
            if (compound) {
                jungChar = compound;
                jungConsumed = 3;
            }
        }

        const jung = JUNG_LIST.indexOf(jungChar);
        if (jung === -1) { result.push(cur); i++; continue; }

        // 종성 처리
        let jong = 0;
        let totalConsumed = jungConsumed;
        const afterJung = i + jungConsumed;

        if (afterJung < jamo.length && isConsonant(jamo[afterJung])) {
            const jongChar = jamo[afterJung];

            // 다음에 모음이 오는지 확인 (종성이 다음 초성으로 넘어가야 하는지)
            if (afterJung + 1 < jamo.length && isVowel(jamo[afterJung + 1])) {
                // 다음이 모음이면 이 자음은 종성이 아니라 다음 초성
                // 종성 없이 현재 글자 완성
            } else {
                // 복합 종성 확인
                if (afterJung + 1 < jamo.length && isConsonant(jamo[afterJung + 1])) {
                    const compoundJong = COMPOUND_JONG[jongChar + jamo[afterJung + 1]];
                    if (compoundJong) {
                        // 복합 종성 후 다음에 모음이 오는지 확인
                        if (afterJung + 2 < jamo.length && isVowel(jamo[afterJung + 2])) {
                            // 복합 종성의 두번째 자음이 다음 초성으로 넘어감
                            // 첫번째 자음만 종성으로 사용
                            jong = JONG_LIST.indexOf(jongChar);
                            if (jong > 0) totalConsumed = jungConsumed + 1;
                        } else {
                            // 복합 종성 완성
                            jong = JONG_LIST.indexOf(compoundJong);
                            if (jong > 0) totalConsumed = jungConsumed + 2;
                            else {
                                // 복합 종성이 종성 목록에 없으면 단일 종성
                                jong = JONG_LIST.indexOf(jongChar);
                                if (jong > 0) totalConsumed = jungConsumed + 1;
                            }
                        }
                    } else {
                        // 복합 종성 불가 → 단일 종성
                        // 두번째 자음 뒤에 모음이 오는지 확인
                        if (afterJung + 2 < jamo.length && isVowel(jamo[afterJung + 2])) {
                            // 단일 종성, 두번째 자음은 다음 초성
                            jong = JONG_LIST.indexOf(jongChar);
                            if (jong > 0) totalConsumed = jungConsumed + 1;
                        } else {
                            // 단일 종성
                            jong = JONG_LIST.indexOf(jongChar);
                            if (jong > 0) totalConsumed = jungConsumed + 1;
                        }
                    }
                } else {
                    // 단일 종성
                    jong = JONG_LIST.indexOf(jongChar);
                    if (jong > 0) totalConsumed = jungConsumed + 1;
                }
            }
        }

        // 완성형 한글 조합: 0xAC00 + (초성 × 21 + 중성) × 28 + 종성
        const code = 0xAC00 + (cho * 21 + jung) * 28 + jong;
        result.push(String.fromCharCode(code));
        i += totalConsumed;
    }

    return result.join('');
}

/**
 * 문자열이 영타→한타 변환 대상인지 판별
 * 영문 알파벳만으로 구성된 경우 (숫자, 공백 등은 제외)
 */
function shouldConvertToKor(str) {
    if (!str) return false;
    // 한글이 이미 포함되어 있으면 변환 불필요
    if (/[\uAC00-\uD7AF\u3131-\u318E]/.test(str)) return false;
    // 영문 알파벳이 포함되어 있으면 변환 대상
    return /[a-zA-Z]/.test(str);
}
