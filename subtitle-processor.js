// 전역 변수
let mistranslationDict = {};
let isConnected = false;
let currentSpreadsheetId = '';
let apiInitialized = false;

// 멤버 성+이름 풀네임 목록 (성이 붙은 형태는 오표기 치환에서 제외)
const MEMBER_FULL_NAMES = [
    'Nam Yejun', 'Han Noah', 'Chae Bamby', 'Do Eunho', 'Yu Hamin'
];

// Google API 초기화 (CORS 문제 해결)
function initializeGoogleAPI() {
    if (typeof gapi === 'undefined') {
        console.error('Google API가 로드되지 않았습니다');
        updateConnectionStatus('Google API 로드 실패', 'error');
        return;
    }

    gapi.load('client', {
        callback: function() {
            gapi.client.init({
                'apiKey': CONFIG.API_KEY,
                'discoveryDocs': ["https://sheets.googleapis.com/$discovery/rest?version=v4"],
            }).then(function() {
                console.log('Google API 초기화 완료');
                apiInitialized = true;
                updateConnectionStatus('API 준비 완료', 'success');
            }).catch(function(error) {
                console.error('API 초기화 실패:', error);
                updateConnectionStatus('API 초기화 실패: ' + error.message, 'error');
            });
        },
        onerror: function() {
            console.error('gapi.client 로드 실패');
            updateConnectionStatus('Google Client 로드 실패', 'error');
        }
    });
}

// 언어별 Google Sheets 연결 (새로운 함수)
async function connectToLanguageSheet(language) {
    if (!apiInitialized) {
        updateConnectionStatus('Google API가 아직 초기화되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }

    const spreadsheetId = CONFIG.SPREADSHEET_IDS[language];

    if (!spreadsheetId) {
        updateConnectionStatus('해당 언어의 시트 ID가 설정되지 않았습니다', 'error');
        return;
    }

    try {
        const languageNames = {
            japanese: '일본어',
            chinese: '중국어',
            english: '영어'
        };

        updateConnectionStatus(`${languageNames[language]} 시트 연결 중...`, 'success');

        // 스프레드시트 접근 테스트
        await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'A1:B1',
        });

        isConnected = true;
        currentSpreadsheetId = spreadsheetId;
        updateConnectionStatus(`${languageNames[language]} 시트 연결 성공!`, 'success');
        refreshDictionary();

    } catch (error) {
        console.error('연결 실패:', error);

        let errorMessage = '연결 실패: ';
        if (error.status === 400) {
            errorMessage += 'API 키 설정을 확인해주세요';
        } else if (error.status === 403) {
            errorMessage += '스프레드시트 공유 권한을 확인해주세요';
        } else {
            errorMessage += error.result?.error?.message || '알 수 없는 오류';
        }

        updateConnectionStatus(errorMessage, 'error');
    }
}


async function refreshDictionary() {
    if (!isConnected) {
        updateConnectionStatus('먼저 Google Sheets에 연결해주세요', 'error');
        return;
    }
    
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: currentSpreadsheetId,
            range: 'A:Z',
        });
        
        const values = response.result.values;
        mistranslationDict = {};
        
        if (values && values.length > 1) {
            for (let i = 1; i < values.length; i++) {
                const row = values[i];
                if (row[1]) { // B열에 올바른 단어가 있는 경우
                    const correctWord = row[1];
                    
                    // C열부터 Z열까지 오역들 확인
                    for (let j = 2; j < row.length && j < 26; j++) {
                        if (row[j] && row[j].trim()) {
                            mistranslationDict[row[j].trim()] = correctWord;
                        }
                    }
                }
            }
        }
        
        updateDictionaryDisplay();
        
    } catch (error) {
        console.error('사전 로드 실패:', error);
        updateConnectionStatus('사전 로드 실패', 'error');
    }
}

// 자막 파일 처리
function processFile() {
    const fileInput = document.getElementById('subtitle-file');
    const originalTextArea = document.getElementById('original-subtitle');
    
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const content = e.target.result;
            originalTextArea.value = content;
            processSubtitles(content);
        };
        
        reader.readAsText(file, 'utf-8');
    } else if (originalTextArea.value.trim()) {
        processSubtitles(originalTextArea.value);
    } else {
        alert('자막 파일을 선택하거나 텍스트를 입력해주세요');
    }
}

// 1단계: 오역 수정만 (자동 수정 기능 제거)
function processSubtitles(srtContent) {
    if (Object.keys(mistranslationDict).length === 0) {
        updateConnectionStatus('오역 사전이 비어있습니다. 스프레드시트를 확인해주세요', 'error');
        return;
    }

    let correctedContent = srtContent;
    let changesCount = 0;
    const modifiedSubtitles = [];

    const subtitles = parseSRT(srtContent);

    subtitles.forEach((subtitle) => {
        let originalText = subtitle.text;
        let modifiedText = originalText;
        let hasChanges = false;
        const subtitleChanges = [];

        // 오역 사전 기반 수정
        for (const [wrongWord, correctWord] of Object.entries(mistranslationDict)) {
            let regex;

            if (/^[a-zA-Z0-9]/.test(wrongWord) && /[a-zA-Z0-9]$/.test(wrongWord)) {
                regex = new RegExp('\\b' + escapeRegExp(wrongWord) + '\\b', 'g');
            } else {
                regex = new RegExp(escapeRegExp(wrongWord), 'g');
            }

            // 성+이름 풀네임 내의 이름 부분은 치환 제외
            if (isPartOfFullName(wrongWord, modifiedText)) {
                continue;
            }

            const matches = modifiedText.match(regex);

            if (matches) {
                hasChanges = true;
                changesCount += matches.length;
                subtitleChanges.push(`${wrongWord} → ${correctWord}`);
                modifiedText = modifiedText.replace(regex, correctWord);
            }
        }

        if (hasChanges) {
            modifiedSubtitles.push({
                id: subtitle.id,
                time: subtitle.time,
                originalText: originalText,
                modifiedText: modifiedText,
                changes: subtitleChanges
            });
        }

        subtitle.text = modifiedText;
    });

    correctedContent = generateSRT(subtitles);
    displayModifiedSubtitles(modifiedSubtitles);
    document.getElementById('full-corrected-subtitle').value = correctedContent;

    // 결과 메시지
    if (changesCount > 0) {
        updateConnectionStatus(`1단계 완료: ${changesCount}개 오역 수정 (총 ${modifiedSubtitles.length}개 자막 수정)`, 'success');
    } else {
        updateConnectionStatus('1단계 완료: 수정할 내용이 발견되지 않았습니다', 'success');
    }
}




// 2단계: 한국어 검출 함수 (구조화된 데이터 반환)
function detectKoreanInSubtitles(srtContent) {
    const koreanPattern = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
    const warnings = [];
    const subtitles = parseSRT(srtContent);

    subtitles.forEach(subtitle => {
        if (koreanPattern.test(subtitle.text)) {
            warnings.push({
                id: subtitle.id,
                time: subtitle.time,
                text: subtitle.text
            });
        }
    });

    return warnings;
}

// 2단계: 세그먼트 번호 검사 함수 (구조화된 데이터 반환)
function checkSegmentNumbers(subtitles) {
    const issues = [];
    const seenIds = new Set();

    subtitles.forEach((subtitle, index) => {
        const id = parseInt(subtitle.id);
        const expected = index + 1;
        const position = index + 1;

        // 세그먼트 번호에 점이 붙어있는 경우 감지
        if (subtitle.rawId && /\.$/.test(subtitle.rawId)) {
            issues.push({
                kind: 'dot',
                label: '번호 점 오류',
                detail: `${position}번째 세그먼트 번호에 점이 붙어 있음 (${subtitle.rawId})`,
                time: subtitle.time
            });
        }

        if (seenIds.has(id)) {
            issues.push({
                kind: 'duplicate',
                label: '중복',
                detail: `${id}번이 ${position}번째 위치에서 다시 등장`,
                time: subtitle.time
            });
        } else {
            seenIds.add(id);
        }

        if (id !== expected) {
            issues.push({
                kind: 'order',
                label: '순서 오류',
                detail: `${position}번째 위치에 ${id}번 (예상: ${expected}번)`,
                time: subtitle.time
            });
        }
    });

    return issues;
}

// 2단계: 검수 메인 함수 (탭 카드 렌더링)
function validateSubtitles(srtContent) {
    const subtitles = parseSRT(srtContent);
    const koreanWarnings = detectKoreanInSubtitles(srtContent);
    const segmentIssues = checkSegmentNumbers(subtitles);
    const autoFixResult = collectAutoCorrections(subtitles);
    renderValidationResult(koreanWarnings, segmentIssues, autoFixResult);
}

// 자동 수정 항목을 수집하고 수정된 SRT 컨텐츠를 생성
function collectAutoCorrections(subtitles) {
    const modifiedSubtitles = [];
    const workingSubtitles = subtitles.map(s => ({ ...s }));

    workingSubtitles.forEach((subtitle) => {
        const originalText = subtitle.text;
        let modifiedText = originalText;
        let hasAutoFix = false;
        const subtitleChanges = [];

        // 1. 숫자 뒤 온점 추가
        if (/(\b\d+)$/.test(modifiedText)) {
            modifiedText = modifiedText.replace(/(\b\d+)$/g, '$1.');
            hasAutoFix = true;
            subtitleChanges.push('숫자 뒤 온점 추가');
        }

        // 2. 텍스트 공백 정리
        const trimmedText = modifiedText.trim();
        if (trimmedText !== modifiedText) {
            modifiedText = trimmedText;
            hasAutoFix = true;
            subtitleChanges.push('텍스트 공백 정리');
        }

        if (hasAutoFix) {
            modifiedSubtitles.push({
                id: subtitle.id,
                time: subtitle.time,
                originalText: originalText,
                modifiedText: modifiedText,
                changes: subtitleChanges
            });
        }

        subtitle.text = modifiedText;
    });

    return {
        items: modifiedSubtitles,
        correctedContent: generateSRT(workingSubtitles)
    };
}

function renderValidationResult(koreanWarnings, segmentIssues, autoFixResult) {
    const container = document.getElementById('validation-list');
    const summary = document.getElementById('validation-summary');
    const totalEl = document.getElementById('validation-total');
    const tabsEl = document.getElementById('validation-tabs');
    const downloadBtn = document.getElementById('validation-download-btn');

    // 자동수정 결과 SRT 저장 (다운로드용)
    document.getElementById('validation-corrected-subtitle').value = autoFixResult.correctedContent || '';

    // 탭 카운트 업데이트
    document.getElementById('tab-count-korean').textContent = koreanWarnings.length;
    document.getElementById('tab-count-segment').textContent = segmentIssues.length;
    document.getElementById('tab-count-auto').textContent = autoFixResult.items.length;

    const total = koreanWarnings.length + segmentIssues.length + autoFixResult.items.length;

    if (total === 0) {
        summary.hidden = false;
        summary.className = 'validation-summary validation-summary-ok';
        totalEl.textContent = '✅ 검수 완료: 문제점이 발견되지 않았습니다.';
        tabsEl.hidden = true;
        downloadBtn.hidden = true;
        container.innerHTML = '';
        return;
    }

    summary.hidden = false;
    summary.className = 'validation-summary validation-summary-warn';
    totalEl.textContent = `⚠️ 총 ${total}건의 문제점이 발견되었습니다`;
    tabsEl.hidden = false;
    downloadBtn.hidden = autoFixResult.items.length === 0;

    // 한국어 검출 패널
    const koreanPanel = koreanWarnings.length > 0
        ? koreanWarnings.map(w => `
            <article class="diff-card diff-card-korean">
                <header class="diff-card-header">
                    <span class="diff-card-id">#${escapeHtml(w.id)}</span>
                    <span class="diff-card-time">${escapeHtml(w.time)}</span>
                </header>
                <div class="diff-card-body">
                    <div class="diff-line diff-line-warn">
                        <span class="diff-marker">자막</span>
                        <span class="diff-text">${escapeHtml(w.text)}</span>
                    </div>
                </div>
            </article>
        `).join('')
        : '<p class="diff-empty">한국어가 검출된 자막이 없습니다.</p>';

    // 세그먼트 번호 패널
    const segmentPanel = segmentIssues.length > 0
        ? segmentIssues.map(issue => `
            <article class="diff-card diff-card-segment">
                <header class="diff-card-header">
                    <span class="diff-card-id">${escapeHtml(issue.label)}</span>
                    <span class="diff-card-time">${escapeHtml(issue.time)}</span>
                </header>
                <div class="diff-card-body">
                    <div class="diff-line diff-line-error">
                        <span class="diff-marker">내용</span>
                        <span class="diff-text">${escapeHtml(issue.detail)}</span>
                    </div>
                </div>
            </article>
        `).join('')
        : '<p class="diff-empty">세그먼트 번호 문제가 발견되지 않았습니다.</p>';

    // 기타 오류 수정 패널
    const autoPanel = autoFixResult.items.length > 0
        ? autoFixResult.items.map(item => {
            const changesHtml = item.changes
                .map(c => `<span class="diff-tag">${escapeHtml(c)}</span>`)
                .join('');
            return `
                <article class="diff-card">
                    <header class="diff-card-header">
                        <span class="diff-card-id">#${escapeHtml(item.id)}</span>
                        <span class="diff-card-time">${escapeHtml(item.time)}</span>
                    </header>
                    <div class="diff-card-body">
                        <div class="diff-line diff-line-old">
                            <span class="diff-marker">원본</span>
                            <span class="diff-text">${escapeHtml(item.originalText)}</span>
                        </div>
                        <div class="diff-line diff-line-new">
                            <span class="diff-marker">수정본</span>
                            <span class="diff-text">${escapeHtml(item.modifiedText)}</span>
                        </div>
                    </div>
                    <footer class="diff-card-footer">${changesHtml}</footer>
                </article>
            `;
        }).join('')
        : '<p class="diff-empty">자동 수정할 항목이 없습니다.</p>';

    container.innerHTML = `
        <div class="validation-tab-panel active" data-panel="korean">
            <div class="diff-list">${koreanPanel}</div>
        </div>
        <div class="validation-tab-panel" data-panel="segment">
            <div class="diff-list">${segmentPanel}</div>
        </div>
        <div class="validation-tab-panel" data-panel="auto">
            <div class="diff-list">${autoPanel}</div>
        </div>
    `;

    // 기본 탭은 검출된 항목이 있는 첫 카테고리로
    let defaultTab = 'korean';
    if (koreanWarnings.length === 0 && segmentIssues.length > 0) defaultTab = 'segment';
    else if (koreanWarnings.length === 0 && segmentIssues.length === 0) defaultTab = 'auto';
    switchValidationTab(defaultTab);
}

// 탭 전환
function switchValidationTab(tabName) {
    document.querySelectorAll('.validation-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.validation-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === tabName);
    });
}

// 자동 수정 결과 다운로드
function downloadValidationResult() {
    const fullText = document.getElementById('validation-corrected-subtitle').value;
    if (!fullText.trim()) {
        alert('처리된 자막이 없습니다');
        return;
    }
    downloadFile(fullText, 'auto_corrected_subtitle.srt', 'text/plain');
}

// 2단계: 파일 검수 처리 함수
function validateFile() {
    const fileInput = document.getElementById('validation-file');

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();

        reader.onload = function(e) {
            validateSubtitles(e.target.result);
        };

        reader.readAsText(file, 'utf-8');
    } else {
        alert('검수할 자막 파일을 선택해주세요');
    }
}

// SRT 자막 파싱
function parseSRT(srtContent) {
    const subtitles = [];
    const blocks = srtContent.trim().split(/\n\s*\n/); // 수정됨

    blocks.forEach(block => {
        const lines = block.trim().split('\n'); // 수정됨
        if (lines.length >= 3) {
            const rawId = lines[0].trim();
            const subtitle = {
                id: rawId.replace(/\.$/, ''), // 후행 점 제거 후 저장
                rawId: rawId,                  // 원본 ID (점 포함 여부 감지용)
                time: lines[1].trim(),
                text: lines.slice(2).join('\n') // 수정됨
            };
            subtitles.push(subtitle);
        }
    });

    return subtitles;
}



// HTML 이스케이프 헬퍼
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 수정된 자막을 카드 리스트로 렌더링
function displayModifiedSubtitles(modifiedSubtitles) {
    const listEl = document.getElementById('diff-list');
    const summaryEl = document.getElementById('diff-summary');
    const countEl = document.getElementById('diff-count');

    if (!modifiedSubtitles || modifiedSubtitles.length === 0) {
        summaryEl.hidden = true;
        listEl.innerHTML = '<p class="diff-empty">수정할 오표기가 발견되지 않았습니다.</p>';
        return;
    }

    summaryEl.hidden = false;
    countEl.textContent = modifiedSubtitles.length;

    const cardsHtml = modifiedSubtitles.map(subtitle => {
        const changesHtml = subtitle.changes
            .map(c => `<span class="diff-tag">${escapeHtml(c)}</span>`)
            .join('');
        return `
            <article class="diff-card">
                <header class="diff-card-header">
                    <span class="diff-card-id">#${escapeHtml(subtitle.id)}</span>
                    <span class="diff-card-time">${escapeHtml(subtitle.time)}</span>
                </header>
                <div class="diff-card-body">
                    <div class="diff-line diff-line-old">
                        <span class="diff-marker">원본</span>
                        <span class="diff-text">${escapeHtml(subtitle.originalText)}</span>
                    </div>
                    <div class="diff-line diff-line-new">
                        <span class="diff-marker">수정본</span>
                        <span class="diff-text">${escapeHtml(subtitle.modifiedText)}</span>
                    </div>
                </div>
                <footer class="diff-card-footer">${changesHtml}</footer>
            </article>
        `;
    }).join('');

    listEl.innerHTML = cardsHtml;
}

// 전체 자막 파일 다운로드 (수정된 내용 적용)
function downloadResult() {
    const fullText = document.getElementById('full-corrected-subtitle').value;
    
    if (!fullText.trim()) {
        alert('처리된 자막이 없습니다');
        return;
    }
    
    downloadFile(fullText, 'corrected_subtitle.srt', 'text/plain');
}


// 파일 다운로드 헬퍼 함수
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}


// 성+이름 풀네임에 포함된 이름인지 확인 (대소문자 무시)
function isPartOfFullName(wrongWord, text) {
    return MEMBER_FULL_NAMES.some(fullName => {
        const fullNameRegex = new RegExp(escapeRegExp(fullName), 'gi');
        if (!fullNameRegex.test(text)) return false;
        // 풀네임의 이름 부분(성 제외)과 wrongWord가 대소문자 무시 시 같은지 확인
        const namePart = fullName.split(' ').slice(1).join(' ');
        return wrongWord.toLowerCase() === namePart.toLowerCase();
    });
}

// 유틸리티 함수들
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateConnectionStatus(message, type) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
    }
}

// 오역 사전 표시
function updateDictionaryDisplay() {
    const countElement = document.getElementById('dict-count');
    const previewElement = document.getElementById('dict-preview');
    
    // 개수 표시
    countElement.textContent = Object.keys(mistranslationDict).length;
    
    // 올바른 단어별로 그룹화
    const groupedDict = {};
    for (const [wrong, correct] of Object.entries(mistranslationDict)) {
        if (!groupedDict[correct]) {
            groupedDict[correct] = [];
        }
        groupedDict[correct].push(wrong);
    }
    
    // HTML 생성
    let previewHTML = '<strong>📝 오역 그룹별 현황</strong><br><br>';
    
    // 그룹별로 표시
    Object.entries(groupedDict).forEach(([correctWord, wrongWords]) => {
        previewHTML += `<div style="margin-bottom: 15px;">`;
        previewHTML += `<span style="color: #2980b9; font-weight: bold;">📝 ${correctWord} 관련 오역 (${wrongWords.length}개)</span><br>`;
        previewHTML += `<span style="margin-left: 20px; color: #e74c3c;">• ${wrongWords.join(', ')}</span>`;
        previewHTML += `</div>`;
    });
    
    // 총 그룹 수 표시
    const groupCount = Object.keys(groupedDict).length;
    if (groupCount > 0) {
        previewHTML += `<hr style="margin: 15px 0; border: 1px solid #ddd;">`;
        previewHTML += `<em style="color: #7f8c8d;">총 ${groupCount}개 그룹, ${Object.keys(mistranslationDict).length}개 오역 항목</em>`;
    }
    
    previewElement.innerHTML = previewHTML;
}


// SRT 자막 생성 함수 추가
function generateSRT(subtitles) {
    return subtitles.map(sub => 
        `${sub.id}\n${sub.time}\n${sub.text}`
    ).join('\n\n');
}

// 한국어 검출 기능
function DetectKorean(text) {
   const Koreanpattern = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
   return Koreanpattern.test(text);
}
