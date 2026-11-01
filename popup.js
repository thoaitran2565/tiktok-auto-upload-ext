document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const jsonFileInput = document.getElementById('jsonFile');
    const videoSelect = document.getElementById('videoSelect');
    const videoFileInput = document.getElementById('videoFile');
    const delayMinutesInput = document.getElementById('delayMinutes');
    const uploadBtn = document.getElementById('uploadBtn');

    let videoDataMap = {}; // Lưu trữ đường dẫn từ JSON

    // 1. Đọc file JSON và tự động lọc trạng thái "Đã duyệt"
    jsonFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            let items = Array.isArray(data) ? data : [data];

            const approvedVideos = items.filter(item => 
                item.status && item.status.trim() === "Đã duyệt"
            );

            videoSelect.innerHTML = '<option value="">-- Chọn video đã duyệt --</option>';
            videoDataMap = {};

            if (approvedVideos.length === 0) {
                statusDiv.style.color = '#ff4d4d';
                statusDiv.innerText = 'Không tìm thấy video nào có trạng thái "Đã duyệt"!';
                return;
            }

            approvedVideos.forEach(vid => {
                const option = document.createElement('option');
                option.value = vid.filename;
                option.textContent = `${vid.filename}`;
                videoSelect.appendChild(option);
                videoDataMap[vid.filename] = vid.path;
            });

            statusDiv.style.color = '#00ffcc';
            statusDiv.innerText = `Tìm thấy ${approvedVideos.length} video đã duyệt!`;
        } catch (err) {
            statusDiv.style.color = '#ff4d4d';
            statusDiv.innerText = 'Lỗi đọc file JSON: ' + err.message;
        }
    });

    // 2. Gợi ý khi chọn video từ dropdown
    videoSelect.addEventListener('change', (e) => {
        const selectedFileName = e.target.value;
        if (selectedFileName) {
            statusDiv.style.color = '#00ffcc';
            statusDiv.innerText = `Đã chọn: ${selectedFileName}. Hãy chọn file video vật lý tương ứng ở mục 3 để upload.`;
        }
    });

    // 3. Thực hiện upload hàng loạt lên TikTok Studio kèm tính năng Delay
    uploadBtn.addEventListener('click', async () => {
        if (videoFileInput.files.length === 0) {
            statusDiv.style.color = '#ff4d4d';
            statusDiv.innerText = 'Vui lòng chọn ít nhất một file video ở mục 3!';
            return;
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('tiktok.com')) {
            statusDiv.style.color = '#ff4d4d';
            statusDiv.innerText = 'Hãy mở trang TikTok Studio trước!';
            return;
        }

        const filesArray = Array.from(videoFileInput.files);
        const delayMinutes = parseFloat(delayMinutesInput.value) || 0;
        const delayMs = delayMinutes * 60 * 1000;

        statusDiv.style.color = '#00ffcc';
        
        // Vòng lặp xử lý tuần tự từng video
        for (let i = 0; i < filesArray.length; i++) {
            const file = filesArray[i];
            statusDiv.innerText = `Đang xử lý [${i+1}/${filesArray.length}]: ${file.name}`;

            try {
                const base64Data = await convertFileToBase64(file);
                
                // Gửi lệnh xử lý tuần tự
                const result = await executeUploadSequence(tab.id, base64Data, file.name, file.type);
                
                if (!result || !result[0] || !result[0].result.success) {
                    throw new Error(result && result[0] ? result[0].result.message : 'Lỗi không xác định');
                }
                
                statusDiv.innerText = `Đã hoàn thành video: ${file.name}.`;

                // Nếu chưa phải video cuối cùng thì thực hiện đếm ngược thời gian delay
                if (i < filesArray.length - 1 && delayMs > 0) {
                    let remainingTime = delayMs;
                    while (remainingTime > 0) {
                        const minutesLeft = Math.floor(remainingTime / 60000);
                        const secondsLeft = Math.floor((remainingTime % 60000) / 1000);
                        statusDiv.innerText = `Đã xong ${file.name}. Chờ ${minutesMinutesText(minutesLeft, secondsLeft)} trước khi đăng video tiếp theo...`;
                        
                        const waitTime = Math.min(remainingTime, 1000);
                        await new Promise(r => setTimeout(r, waitTime));
                        remainingTime -= waitTime;
                    }
                }
                
            } catch (err) {
                statusDiv.style.color = '#ff4d4d';
                statusDiv.innerText = `Lỗi ở video ${file.name}: ${err.message}`;
                break; // Dừng lại nếu lỗi
            }
        }

        statusDiv.style.color = '#00ffcc';
        statusDiv.innerText = 'Đã hoàn thành toàn bộ danh sách video!';
    });
});

// Hàm định dạng hiển thị thời gian đếm ngược
function minutesMinutesText(m, s) {
    return `${m} phút ${s} giây`;
}

// Hàm hỗ trợ thực thi trên trang TikTok Studio
function executeUploadSequence(tabId, base64Data, fileName, fileType) {
    return new Promise((resolve) => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: handleAutoPostWorkflow,
            args: [base64Data, fileName, fileType]
        }, (results) => {
            resolve(results);
        });
    });
}

// Hàm chạy bên trong ngữ cảnh trang web TikTok Studio theo đúng quy trình yêu cầu
function handleAutoPostWorkflow(base64Data, fileName, fileType) {
    return new Promise(async (resolve) => {
        try {
            // Bước 0: Đảm bảo đang ở đúng trang upload và đợi khung kéo thả sẵn sàng
            let dropZoneReadyAttempts = 0;
            const waitForDropZoneReady = () => {
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
                            res(dropZone);
                        } else if (dropZoneReadyAttempts >= 45) { // Chờ tối đa 45 giây để trang upload load xong hẳn
                            clearInterval(interval);
                            rej(new Error('Không tìm thấy khung kéo thả video trên trang upload!'));
                        }
                    }, 1000);
                });
            };

            let dropZone = await waitForDropZoneReady();
            let fileInput = document.querySelector('input[type="file"]');

            // Bước 1: Giải mã base64 thành File object
            const arr = base64Data.split(',');
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) { u8arr[n] = bstr.charCodeAt(n); }
            const videoFile = new File([u8arr], fileName, { type: fileType || mime });

            // Bước 2: Kéo thả file vào khung
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(videoFile);
            ['dragenter', 'dragover', 'drop'].forEach(eventType => {
                dropZone.dispatchEvent(new DragEvent(eventType, { bubbles: true, cancelable: true, dataTransfer }));
            });

            if (fileInput) {
                fileInput.files = dataTransfer.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Bước 3: Chờ đến khi nút "Đăng" thực sự load xong và SẴN SÀNG rồi mới bấm
            let attempts = 0;
            const maxAttempts = 90; // Tối đa 90 giây chờ video nặng upload lên xong
            
            const waitForPostButtonAndClick = () => {
                return new Promise((res, rej) => {
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
                                targetBtn.click(); // Bấm nút Đăng
                                res();
                            }
                        } 
                        
                        if (attempts >= maxAttempts) {
                            clearInterval(interval);
                            rej(new Error(`Hết thời gian chờ nút Đăng sẵn sàng cho video: ${fileName}`));
                        }
                    }, 1000);
                });
            };

            await waitForPostButtonAndClick();

            // Bước 4: Kiểm tra và bấm popup xác nhận "Đăng ngay" nếu có
            await new Promise(r => setTimeout(r, 1500));
            let popupBtns = Array.from(document.querySelectorAll('button, div[role="button"]'));
            let popupConfirm = popupBtns.find(el => el.innerText && (el.innerText.trim() === 'Đăng ngay' || el.innerText.trim() === 'Xác nhận'));
            if (popupConfirm) {
                popupConfirm.click();
            }

            // Bước 5: Kiểm tra chuyển hướng sang trang https://www.tiktok.com/tiktokstudio/content
            let urlCheckAttempts = 0;
            const waitForContentPage = () => {
                return new Promise((res, rej) => {
                    const interval = setInterval(() => {
                        urlCheckAttempts++;
                        if (window.location.href.includes('/tiktokstudio/content')) {
                            clearInterval(interval);
                            res();
                        } else if (urlCheckAttempts >= 45) { // Chờ tối đa 45 giây chuyển trang
                            clearInterval(interval);
                            rej(new Error('Hết thời gian chờ chuyển sang trang quản lý nội dung (/tiktokstudio/content)'));
                        }
                    }, 1000);
                });
            };

            await waitForContentPage();

            // Bước 6: Khi đã qua trang nội dung, tìm và bấm nút "Tải lên"
            let clickUploadAttempts = 0;
            const waitForUploadButtonAndClick = () => {
                return new Promise((res, rej) => {
                    const interval = setInterval(() => {
                        clickUploadAttempts++;
                        
                        let uploadBtnElem = document.querySelector('button[data-tt="Sidebar_UploadEntrance_WideButton"]') || 
                            Array.from(document.querySelectorAll('button, div[role="button"]')).find(el => {
                                let text = el.innerText ? el.innerText.trim() : '';
                                return text.includes('Tải lên') || text.includes('Upload');
                            });

                        if (uploadBtnElem) {
                            let isDisabled = uploadBtnElem.disabled || uploadBtnElem.getAttribute('aria-disabled') === 'true';
                            if (!isDisabled) {
                                clearInterval(interval);
                                uploadBtnElem.click(); // Bấm nút Tải lên
                                res();
                            }
                        }

                        if (clickUploadAttempts >= 30) {
                            clearInterval(interval);
                            rej(new Error('Không tìm thấy nút "Tải lên" trên trang nội dung!'));
                        }
                    }, 1000);
                });
            };

            await waitForUploadButtonAndClick();

            // Bước 7: Kiểm tra chuyển hướng lại trang upload (https://www.tiktok.com/tiktokstudio/upload?...)
            let redirectCheckAttempts = 0;
            const waitForUploadPage = () => {
                return new Promise((res, rej) => {
                    const interval = setInterval(() => {
                        redirectCheckAttempts++;
                        if (window.location.href.includes('/tiktokstudio/upload')) {
                            clearInterval(interval);
                            res();
                        } else if (redirectCheckAttempts >= 30) {
                            clearInterval(interval);
                            rej(new Error('Hết thời gian chờ quay lại trang upload!'));
                        }
                    }, 1000);
                });
            };

            await waitForUploadPage();

            resolve({ success: true, message: `Đã đăng thành công video: ${fileName}` });

        } catch (error) {
            resolve({ success: false, message: error.message });
        }
    });
}

// Hàm hỗ trợ chuyển đổi file sang Base64
function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}