document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const videoFileInput = document.getElementById('videoFile');
    const delayMinutesInput = document.getElementById('delayMinutes');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileLabel = document.getElementById('fileLabel');
    const estTimeBadge = document.getElementById('estTimeBadge');
    const inputSection = document.getElementById('inputSection');
    const guidePanel = document.getElementById('guidePanel');

    const progressPanel = document.getElementById('progressPanel');
    const videoCountText = document.getElementById('videoCountText');
    const percentText = document.getElementById('percentText');
    const progressBarFill = document.getElementById('progressBarFill');
    const workflowBox = document.getElementById('workflowBox');
    const stepProgressBarFill = document.getElementById('stepProgressBarFill');
    const delayPanel = document.getElementById('delayPanel');
    const delayTimerText = document.getElementById('delayTimerText');

    let accumulatedFiles = [];
    let isRunning = false;
    let isStopRequested = false;
    let successfullyUploadedFiles = [];
    let activeDelayTimer = null;

    videoFileInput.addEventListener('change', function(e) {
        const newFiles = Array.from(e.target.files);
        newFiles.forEach(newFile => {
            const isDuplicate = accumulatedFiles.some(f => f.name === newFile.name && f.size === newFile.size);
            if (!isDuplicate) {
                accumulatedFiles.push(newFile);
            }
        });

        const dt = new DataTransfer();
        accumulatedFiles.forEach(file => dt.items.add(file));
        videoFileInput.files = dt.files;

        updateUIOnFilesSelected();
    });

    delayMinutesInput.addEventListener('input', () => {
        updateEstimatedCompletionTime();
    });

    function updateUIOnFilesSelected() {
        if (accumulatedFiles.length > 0) {
            fileLabel.innerHTML = `<span>📁</span> Đã chọn (${accumulatedFiles.length})`;
            estTimeBadge.style.display = 'inline-block';
            updateEstimatedCompletionTime();
        } else {
            fileLabel.innerHTML = `<span>📁</span> Choose Files`;
            estTimeBadge.style.display = 'none';
        }
    }

    function updateEstimatedCompletionTime() {
        if (accumulatedFiles.length === 0) return;
        const totalVideos = accumulatedFiles.length;
        const delayMins = parseFloat(delayMinutesInput.value) || 0;
        const processingTimePerVideoMins = 1.5; 
        const totalEstimatedMins = (totalVideos * processingTimePerVideoMins) + (Math.max(0, totalVideos - 1) * delayMins);

        const now = new Date();
        const completionTime = new Date(now.getTime() + totalEstimatedMins * 60000);

        const hours = String(completionTime.getHours()).padStart(2, '0');
        const minutes = String(completionTime.getMinutes()).padStart(2, '0');

        estTimeBadge.innerText = `Done: ${hours}:${minutes}`;
    }

    // Cập nhật giao diện 10 bước (0 -> 9)
    function updateStepsUI(currentStep) {
        for (let i = 0; i <= 9; i++) {
            const stepEl = document.getElementById(`step-${i}`);
            if (!stepEl) continue;
            const iconEl = stepEl.querySelector('.step-icon');

            stepEl.classList.remove('active', 'done');
            iconEl.classList.remove('spinning');

            if (i < currentStep) {
                stepEl.classList.add('done');
                iconEl.innerText = '✓';
            } else if (i === currentStep) {
                stepEl.classList.add('active');
                iconEl.innerHTML = '<span class="spinning">⏳</span>';
            } else {
                iconEl.innerText = '○';
            }
        }
        const stepPercent = Math.min(100, Math.max(0, (currentStep / 9) * 100));
        stepProgressBarFill.style.width = `${stepPercent}%`;
    }

    uploadBtn.addEventListener('click', async () => {
        if (!isRunning) {
            if (accumulatedFiles.length === 0) {
                statusDiv.style.color = '#ff4d4d';
                statusDiv.innerText = 'Vui lòng chọn ít nhất một file video!';
                return;
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url || !tab.url.includes('tiktok.com')) {
                statusDiv.style.color = '#ff4d4d';
                statusDiv.innerText = 'Hãy mở trang TikTok Studio trước!';
                return;
            }

            isRunning = true;
            isStopRequested = false;
            successfullyUploadedFiles = [];

            uploadBtn.innerText = '■ Stop';
            uploadBtn.style.background = 'linear-gradient(135deg, #333, #222)';
            uploadBtn.style.border = '1px solid #fe2c55';

            guidePanel.style.display = 'none';
            progressPanel.style.display = 'block';
            statusDiv.innerText = '';

            const filesArray = accumulatedFiles;
            const totalVideos = filesArray.length;
            const delayMinutes = parseFloat(delayMinutesInput.value) || 0;
            const delayMs = delayMinutes * 60 * 1000;

            for (let i = 0; i < totalVideos; i++) {
                if (isStopRequested) break;

                const file = filesArray[i];
                
                const percent = Math.round((i / totalVideos) * 100);
                videoCountText.innerText = `Đã đăng: ${i}/${totalVideos}`;
                percentText.innerText = `${percent}%`;
                progressBarFill.style.width = `${percent}%`;

                workflowBox.style.display = 'block';
                delayPanel.style.display = 'none';
                updateStepsUI(0);

                try {
                    const base64Data = await convertFileToBase64(file);
                    
                    if (isStopRequested) break;

                    let successWorkflow = await runStepByStepWorkflow(tab.id, base64Data, file.name, file.type, (stepIdx) => {
                        updateStepsUI(stepIdx);
                    }, () => isStopRequested);

                    if (!successWorkflow || isStopRequested) {
                        break;
                    }

                    successfullyUploadedFiles.push(file.name);

                    const finalCompleted = i + 1;
                    const finalPercent = Math.round((finalCompleted / totalVideos) * 100);
                    videoCountText.innerText = `Đã đăng: ${finalCompleted}/${totalVideos}`;
                    percentText.innerText = `${finalPercent}%`;
                    progressBarFill.style.width = `${finalPercent}%`;
                    updateStepsUI(10);

                    if (i < totalVideos - 1 && delayMs > 0 && !isStopRequested) {
                        workflowBox.style.display = 'none';
                        delayPanel.style.display = 'block';

                        let remainingTime = delayMs;
                        while (remainingTime > 0 && !isStopRequested) {
                            const minutesLeft = Math.floor(remainingTime / 60000);
                            const secondsLeft = Math.floor((remainingTime % 60000) / 1000);
                            delayTimerText.innerText = `${String(minutesLeft).padStart(2, '0')}:${String(secondsLeft).padStart(2, '0')}`;
                            
                            const waitTime = Math.min(remainingTime, 1000);
                            await new Promise(r => {
                                activeDelayTimer = setTimeout(r, waitTime);
                            });
                            remainingTime -= waitTime;
                        }
                        delayPanel.style.display = 'none';
                    }
                    
                } catch (err) {
                    if (!isStopRequested) {
                        statusDiv.style.color = '#ff4d4d';
                        statusDiv.innerText = `Lỗi ở video ${file.name}: ${err.message}`;
                    }
                    break;
                }
            }

            finalizeAndShowThankYou();

        } else {
            isStopRequested = true;
            if (activeDelayTimer) clearTimeout(activeDelayTimer);
            statusDiv.style.color = '#ff4d4d';
            statusDiv.innerText = 'Đã dừng tiến trình!';
        }
    });

    async function finalizeAndShowThankYou() {
        isRunning = false;

        const textToCopy = successfullyUploadedFiles.join('\n');
        if (textToCopy.length > 0) {
            const textarea = document.createElement('textarea');
            textarea.value = textToCopy;
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
            } catch (err) {
                console.error('Lỗi sao chép clipboard:', err);
            }
            document.body.removeChild(textarea);
        }

        inputSection.style.display = 'none';
        progressPanel.style.display = 'none';
        statusDiv.style.display = 'none';

        const thankYouHtml = `
            <div id="thankYouPanel" style="display: block;">
                <h4>Cảm ơn bạn!</h4>
                <p>Tiến trình đăng video đã hoàn tất hoặc đã dừng.</p>
                <p style="color: #00ffcc; margin-top: 6px; font-size: 10px;">Đã copy ${successfullyUploadedFiles.length} tên file vào clipboard!</p>
                <p style="color: #a0a0ab; margin-top: 10px; font-size: 9px;">Popup sẽ tự động đóng sau 5 giây...</p>
            </div>
        `;
        
        let container = document.getElementById('popupThankYou');
        container.innerHTML = thankYouHtml;
        container.style.display = 'block';

        setTimeout(() => {
            window.close();
        }, 5000);
    }
});

// Điều phối 10 bước (0 đến 9)
async function runStepByStepWorkflow(tabId, base64Data, fileName, fileType, onStep, checkStop) {
    if (checkStop()) return false;
    
    // Bước 0, 1, 2: Đợi trang, giải mã và kéo thả file
    onStep(0);
    let res = await executeScriptOnTab(tabId, step012_DropFile, [base64Data, fileName, fileType]);
    if (!res.success || checkStop()) return false;

    // Bước 3: Chờ video load xong để hiện nút Đăng
    onStep(3);
    res = await executeScriptOnTab(tabId, step3_WaitForUploadComplete);
    if (!res.success || checkStop()) return false;

    // Bước 4: Nhập mô tả & hashtag xuống dòng
    onStep(4);
    res = await executeScriptOnTab(tabId, step4_FillCaptionAndHashtag);
    if (!res.success || checkStop()) return false;

    // Bước 5: Chờ và bấm nút Đăng
    onStep(5);
    res = await executeScriptOnTab(tabId, step5_ClickPostButton);
    if (!res.success || checkStop()) return false;

    // Bước 6: Xác nhận popup Đăng ngay
    onStep(6);
    await executeScriptOnTab(tabId, step6_ConfirmPopup);
    await new Promise(r => setTimeout(r, 1500));
    if (checkStop()) return false;

    // Bước 7: Chờ chuyển sang trang Nội dung
    onStep(7);
    res = await executeScriptOnTab(tabId, step7_WaitForContentPage);
    if (!res.success || checkStop()) return false;

    // Bước 8: Bấm nút Tải lên (Quay lại)
    onStep(8);
    res = await executeScriptOnTab(tabId, step8_ClickUploadEntrance);
    if (!res.success || checkStop()) return false;

    // Bước 9: Xác nhận về lại trang Upload
    onStep(9);
    res = await executeScriptOnTab(tabId, step9_WaitForUploadPage);
    if (!res.success || checkStop()) return false;

    return true;
}

function executeScriptOnTab(tabId, func, args = []) {
    return new Promise((resolve) => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: func,
            args: args
        }, (results) => {
            if (chrome.runtime.lastError || !results || !results[0]) {
                return resolve({ success: false, message: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Lỗi thực thi script' });
            }
            resolve(results[0].result);
        });
    });
}

/* ================= CÁC HÀM CHẠY TRONG NGỮ CẢNH TRANG WEB ================= */

function step012_DropFile(base64Data, fileName, fileType) {
    return new Promise(async (resolve) => {
        try {
            let dropZoneReadyAttempts = 0;
            const waitForDropZone = () => {
                return new Promise((res, rej) => {
                    const interval = setInterval(() => {
                        dropZoneReadyAttempts++;
                        let fileInput = document.querySelector('input[type="file"]');
                        let dropZone = fileInput ? (fileInput.closest('div[class*="upload"]') || fileInput.parentElement) : null;
                        
                        if (!dropZone) {
                            const allDivs = document.querySelectorAll('div');
                            for (let div of allDivs) {
                                if (div.innerText && (div.innerText.includes('Kéo thả video') || div.innerText.includes('Chọn video'))) {
                                    dropZone = div;
                                    break;
                                }
                            }
                        }

                        if (dropZone) {
                            clearInterval(interval);
                            res({ dropZone, fileInput });
                        } else if (dropZoneReadyAttempts >= 45) {
                            clearInterval(interval);
                            rej(new Error('Không tìm thấy khung kéo thả video!'));
                        }
                    }, 1000);
                });
            };

            const target = await waitForDropZone();
            const arr = base64Data.split(',');
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) { u8arr[n] = bstr.charCodeAt(n); }
            const videoFile = new File([u8arr], fileName, { type: fileType || mime });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(videoFile);
            ['dragenter', 'dragover', 'drop'].forEach(eventType => {
                target.dropZone.dispatchEvent(new DragEvent(eventType, { bubbles: true, cancelable: true, dataTransfer }));
            });

            if (target.fileInput) {
                target.fileInput.files = dataTransfer.files;
                target.fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                target.fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            resolve({ success: true });
        } catch (err) {
            resolve({ success: false, message: err.message });
        }
    });
}

function step3_WaitForUploadComplete() {
    return new Promise((resolve) => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            let targetBtn = document.querySelector('button[data-e2e="post_video_button"]') || 
                Array.from(document.querySelectorAll('button, div[role="button"]')).find(el => {
                    let text = el.innerText ? el.innerText.trim() : '';
                    return (text === 'Đăng' || text === 'Post');
                });

            if (targetBtn) {
                let isDisabled = targetBtn.disabled || targetBtn.getAttribute('aria-disabled') === 'true' || targetBtn.getAttribute('data-disabled') === 'true';
                let isLoading = targetBtn.getAttribute('data-loading') === 'true' || targetBtn.querySelector('.Button__spinnerBox--loading-true');

                if (!isDisabled && !isLoading) {
                    clearInterval(interval);
                    resolve({ success: true });
                }
            } 
            
            if (attempts >= 120) {
                clearInterval(interval);
                resolve({ success: false, message: 'Hết thời gian chờ video tải lên xong!' });
            }
        }, 1000);
    });
}

// Bước 4: Tích hợp thuật toán test thực tế của bạn vào đây
function step4_FillCaptionAndHashtag() {
  return new Promise(async (resolve) => {
    // Hàm phụ trợ chuyên xử lý việc nhập và xác nhận một hashtag độc lập
    async function inputSingleHashtag(editor, hashtagText) {
      document.execCommand('insertText', false, hashtagText);

      await new Promise(r => setTimeout(r, 500));
      editor.click();
      editor.focus();
      await new Promise(r => setTimeout(r, 2000));

      const pressEnter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      editor.dispatchEvent(pressEnter);
      editor.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

      await new Promise(r => setTimeout(r, 500));
    }

    try {
      // 1. Tìm ô mô tả trên trang
      let editor = document.querySelector('div[data-e2e="caption_container"] div[contenteditable="true"][role="combobox"]') ||
                   document.querySelector('div[contenteditable="true"][role="combobox"]') ||
                   document.querySelector('textarea');

      if (!editor) {
        return resolve({ success: false, message: 'Không tìm thấy ô nhập mô tả!' });
      }

      // Kiểm tra ô mô tả có hiển thị và sẵn sàng để click không
      const rect = editor.getBoundingClientRect();
      const style = window.getComputedStyle(editor);
      const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';

      if (!isVisible) {
        return resolve({ success: false, message: 'Ô nhập mô tả hiện không hiển thị hoặc chưa sẵn sàng để tương tác!' });
      }

      // 2. Thực hiện click và focus vào ô mô tả
      editor.focus();
      editor.click();
      await new Promise(r => setTimeout(r, 300));

      // Kiểm tra xem đã click/focus thành công chưa
      let isFocused = document.activeElement === editor || editor.contains(document.activeElement);
      
      if (!isFocused) {
        editor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        editor.focus();
        await new Promise(r => setTimeout(r, 300));
        
        isFocused = document.activeElement === editor || editor.contains(document.activeElement);
        if (!isFocused) {
          return resolve({ success: false, message: 'Đã thử click nhưng không thể focus thành công vào ô mô tả!' });
        }
      }

      // Nếu ô mô tả đã có nội dung sẵn, tiến hành xuống dòng 1 cái
      const currentText = editor.innerText ? editor.innerText.trim() : '';
      if (currentText.length > 0) {
        const pressEnter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        editor.dispatchEvent(pressEnter);
        editor.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
      }

      // 3. Khai báo danh sách các hashtag muốn nhập
      const hashtags = ["#cuocsongchill22", "#xuhuongtiktok", "#nhachay"];

      // 4. Lặp qua từng hashtag và gọi hàm xử lý đã tách
      for (let hashtagText of hashtags) {
        await inputSingleHashtag(editor, hashtagText);
      }

      // 5. Kích hoạt sự kiện thay đổi cuối cùng để hoàn tất
      editor.dispatchEvent(new Event('change', { bubbles: true }));

      resolve({ success: true });
    } catch (err) {
      resolve({ success: false, message: err.message });
    }
  });
}

function step5_ClickPostButton() {
    return new Promise((resolve) => {
        let targetBtn = document.querySelector('button[data-e2e="post_video_button"]') || 
            Array.from(document.querySelectorAll('button, div[role="button"]')).find(el => {
                let text = el.innerText ? el.innerText.trim() : '';
                return (text === 'Đăng' || text === 'Post');
            });

        if (targetBtn) {
            targetBtn.click();
            resolve({ success: true });
        } else {
            resolve({ success: false, message: 'Không tìm thấy nút Đăng!' });
        }
    });
}

function step6_ConfirmPopup() {
    return new Promise((resolve) => {
        setTimeout(() => {
            let popupBtns = Array.from(document.querySelectorAll('button, div[role="button"]'));
            let popupConfirm = popupBtns.find(el => el.innerText && (el.innerText.trim() === 'Đăng ngay' || el.innerText.trim() === 'Xác nhận'));
            if (popupConfirm) {
                popupConfirm.click();
            }
            resolve({ success: true });
        }, 1500);
    });
}

function step7_WaitForContentPage() {
    return new Promise((resolve) => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (window.location.href.includes('/tiktokstudio/content')) {
                clearInterval(interval);
                resolve({ success: true });
            } else if (attempts >= 45) {
                clearInterval(interval);
                resolve({ success: false, message: 'Hết thời gian chuyển sang trang nội dung!' });
            }
        }, 1000);
    });
}

function step8_ClickUploadEntrance() {
    return new Promise((resolve) => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            let uploadBtnElem = document.querySelector('button[data-tt="Sidebar_UploadEntrance_WideButton"]') || 
                Array.from(document.querySelectorAll('button, div[role="button"]')).find(el => {
                    let text = el.innerText ? el.innerText.trim() : '';
                    return text.includes('Tải lên') || text.includes('Upload');
                });

            if (uploadBtnElem) {
                let isDisabled = uploadBtnElem.disabled || uploadBtnElem.getAttribute('aria-disabled') === 'true';
                if (!isDisabled) {
                    clearInterval(interval);
                    uploadBtnElem.click();
                    resolve({ success: true });
                }
            }

            if (attempts >= 30) {
                clearInterval(interval);
                resolve({ success: false, message: 'Không tìm thấy nút Tải lên trên trang nội dung!' });
            }
        }, 1000);
    });
}

function step9_WaitForUploadPage() {
    return new Promise((resolve) => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (window.location.href.includes('/tiktokstudio/upload')) {
                clearInterval(interval);
                resolve({ success: true });
            } else if (attempts >= 30) {
                clearInterval(interval);
                resolve({ success: false, message: 'Hết thời gian quay lại trang upload!' });
            }
        }, 1000);
    });
}

function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}