// 전역 변수
let mistranslationDict = {};
let isConnected = false;
let currentSpreadsheetId = '';
let apiInitialized = false;

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

// Google Sheets 공유 링크에서 ID 추출
function extractSpreadsheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

// Google Sheets 연결 (API 초기화 확인 추가)
async function connectToSheets() {
    if (!apiInitialized) {
        updateConnectionStatus('Google API가 아직 초기화되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }

    const sheetUrl = document.getElementById('spreadsheet-url').value.trim();
    
    if (!sheetUrl) {
        updateConnectionStatus('Google Sheets 공유 링크를 입력해주세요', 'error');
        return;
    }
    
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) {
        updateConnectionStatus('올바른 Google Sheets 공유 링크를 입력해주세요', 'error');
        return;
    }
    
    try {
        updateConnectionStatus('연결 중...', 'success');
        
        // 스프레드시트 접근 테스트
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'A1:B1',
        });
        
        isConnected = true;
        currentSpreadsheetId = spreadsheetId;
        updateConnectionStatus('연결 성공!', 'success');
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

// 나머지 함수들은 기존과 동일하게 유지...
// (refreshDictionary, processFile, processSubtitles 등 모든 함수)

// 오역 사전 새로고침
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

// 자막 오역 수정 (행번호 공백 검출 개선)
function processSubtitles(srtContent) {
    if (Object.keys(mistranslationDict).length === 0) {
        updateConnectionStatus('오역 사전이 비어있습니다. 스프레드시트를 확인해주세요', 'error');
        return;
    }
    
    let correctedContent = srtContent;
    let changesCount = 0;
    let autoFixCount = 0;
    const modifiedSubtitles = [];
    
    // 원본 블록들을 먼저 분리 (공백 보존)
    const originalBlocks = srtContent.trim().split(/\n\s*\n/);
    const subtitles = parseSRT(srtContent);
    
    subtitles.forEach((subtitle, index) => {
        let originalText = subtitle.text;
        let modifiedText = originalText;
        let hasChanges = false;
        let hasAutoFix = false;
        const subtitleChanges = [];
        
        // 1. 오역 사전 기반 수정
        for (const [wrongWord, correctWord] of Object.entries(mistranslationDict)) {
            const regex = new RegExp('\\b' + escapeRegExp(wrongWord) + '\\b', 'g');
            const matches = modifiedText.match(regex);
            
            if (matches) {
                hasChanges = true;
                changesCount += matches.length;
                subtitleChanges.push(`${wrongWord} → ${correctWord}`);
                modifiedText = modifiedText.replace(regex, correctWord);
            }
        }
        
        // 2. 자동 수정 기능들
        
        // 2-1. 숫자 뒤 온점 추가 (마지막 단어가 숫자인 경우)
        if (/(\b\d+)$/.test(modifiedText)) {
            modifiedText = modifiedText.replace(/(\b\d+)$/g, '$1.');
            hasAutoFix = true;
            subtitleChanges.push('숫자 뒤 온점 추가');
        }
        
        // 2-2. 텍스트 앞뒤 공백 제거
        const trimmedText = modifiedText.trim();
        if (trimmedText !== modifiedText) {
            modifiedText = trimmedText;
            hasAutoFix = true;
            subtitleChanges.push('텍스트 공백 정리');
        }
        
        // 3. 원본 블록에서 행번호/타임라인 공백 체크
        if (originalBlocks[index]) {
            const blockLines = originalBlocks[index].trim().split('\n');
            
            // 행번호 공백 체크 (첫 번째 줄)
            if (blockLines[0] !== blockLines[0].trim()) {
                hasAutoFix = true;
                subtitleChanges.push('행번호 공백 제거');
            }
            
            // 타임라인 공백 체크 (두 번째 줄)
            if (blockLines[1] && blockLines[1] !== blockLines[1].trim()) {
                hasAutoFix = true;
                subtitleChanges.push('타임라인 공백 제거');
            }
        }
        
        // 수정사항이 있으면 기록
        if (hasChanges || hasAutoFix) {
            if (hasAutoFix) autoFixCount++;
            
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
    if (changesCount > 0 || autoFixCount > 0) {
        let statusMessage = `처리 완료: `;
        if (changesCount > 0) {
            statusMessage += `${changesCount}개 오역 수정`;
        }
        if (autoFixCount > 0) {
            if (changesCount > 0) statusMessage += `, `;
            statusMessage += `${autoFixCount}개 자동 수정`;
        }
        statusMessage += ` (총 ${modifiedSubtitles.length}개 자막 수정)`;
        
        updateConnectionStatus(statusMessage, 'success');
    } else {
        updateConnectionStatus('수정할 내용이 발견되지 않았습니다', 'success');
    }
}

// SRT 자막 파싱 (행번호 공백 수정 포함)
function parseSRT(srtContent) {
    const subtitles = [];
    const blocks = srtContent.trim().split(/\n\s*\n/);
    
    blocks.forEach(block => {
        const lines = block.trim().split('\n');
        if (lines.length >= 3) {
            const subtitle = {
                id: lines[0].trim(), // 행번호 앞뒤 공백 제거
                time: lines[1].trim(), // 타임라인 앞뒤 공백 제거
                text: lines.slice(2).join('\n')
            };
            subtitles.push(subtitle);
        }
    });
    
    return subtitles;
}


// 수정된 자막만 표시하는 함수
function displayModifiedSubtitles(modifiedSubtitles) {
    const processedTextArea = document.getElementById('processed-subtitle');
    
    if (modifiedSubtitles.length === 0) {
        processedTextArea.value = '수정된 대사가 없습니다.';
        return;
    }
    
    let displayText = '=== 수정된 대사 목록 ===\n\n';
    
    modifiedSubtitles.forEach((subtitle, index) => {
        displayText += `${index + 1}. [${subtitle.id}] ${subtitle.time}\n`;
        displayText += `원본: ${subtitle.originalText}\n`;
        displayText += `수정: ${subtitle.modifiedText}\n`;
        displayText += `변경: ${subtitle.changes.join(', ')}\n`;
        displayText += '─'.repeat(50) + '\n\n';
    });
    
    processedTextArea.value = displayText;
}

// 전체 자막 파일 다운로드 (수정된 내용 적용)
function downloadResult() {
    const fullText = document.getElementById('full-corrected-subtitle').value;
    
    if (!fullText.trim()) {
        alert('처리된 자막이 없습니다');
        return;
    }
    
    // 전체 자막 파일 다운로드 (기본값)
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

// 오역 사전 표시 (그룹별 표시 방식)
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
