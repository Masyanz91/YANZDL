// Hilangkan Animasi Splash Screen saat halaman selesai dimuat
window.addEventListener("load", () => {
    setTimeout(() => {
        const splash = document.getElementById("splash-screen");
        if (splash) splash.classList.add("fade-out");
    }, 550);
});

const TIKTOK_API_ENDPOINTS = [
    {
        name: "Server Utama (tikwm)",
        buildUrl: (targetUrl) => "https://www.tikwm.com/api/?url=" + encodeURIComponent(targetUrl) + "&hd=1"
    },
    {
        name: "Server Cadangan 1 (tikwm mirror)",
        buildUrl: (targetUrl) => "https://tikwm.com/api/?url=" + encodeURIComponent(targetUrl) + "&hd=1"
    },
    {
        name: "Server Cadangan 2 (tikwm v1)",
        buildUrl: (targetUrl) => "https://www.tikwm.com/api/feed/search?keywords=" + encodeURIComponent(targetUrl) + "&count=1&cursor=0&hd=1"
    }
];

let currentURL = "";
let currentBioText = "";
let currentCarouselImages = [];
let currentDownloadPrefix = "yanzdl_media";
let toastTimer = null;

function resolveVideoCode(info, sourceUrl = "") {
    const rawId = info && (info.id || info.aweme_id || info.video_id);
    if (rawId !== undefined && rawId !== null) {
        const cleanedId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, "").trim();
        if (cleanedId) return cleanedId;
    }

    const matchFromUrl = String(sourceUrl || "").match(/(?:video|photo)\/(\d+)/i);
    if (matchFromUrl && matchFromUrl[1]) {
        return matchFromUrl[1];
    }

    return "media";
}

function buildYanzDownloadPrefix(info, sourceUrl = "") {
    const code = resolveVideoCode(info, sourceUrl);
    return `yanzdl_${code}`;
}

function resolveBestMediaSources(info) {
    const normalUrl = String((info && (info.play || info.wmplay)) || "").trim();
    const rawHdUrl = String((info && (info.hdplay || info.play)) || "").trim();
    const musicUrl = String((info && (info.music || info.music_info?.play || info.play)) || "").trim();

    const hasDistinctHd = Boolean(rawHdUrl && normalUrl && rawHdUrl !== normalUrl);
    const hdUrl = rawHdUrl || normalUrl;

    return {
        normalUrl,
        hdUrl,
        musicUrl,
        hasDistinctHd
    };
}

function showToast(message, type = "success") {
    const toast = document.getElementById("toastNotification");
    const toastMsg = document.getElementById("toastMessage");
    const toastIcon = document.getElementById("toastIcon");
    if (!toast || !toastMsg || !toastIcon) return;

    toastMsg.textContent = message;
    toastIcon.textContent = type === "copy" ? "📋" : type === "progress" ? "⏳" : "✨";

    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

function showError(message) {
    const errorBox = document.getElementById("errorBox");
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add("show");
}

function clearError() {
    const errorBox = document.getElementById("errorBox");
    if (!errorBox) return;
    errorBox.textContent = "";
    errorBox.classList.remove("show");
}

function syncClearButton() {
    const input = document.getElementById("urlInput");
    const clearBtn = document.getElementById("clearInputBtn");
    if (!input || !clearBtn) return;
    clearBtn.classList.toggle("visible", input.value.length > 0);
}

function clearURLInput() {
    const input = document.getElementById("urlInput");
    clearError();
    if (!input) return;
    input.value = "";
    syncClearButton();
    input.focus();
}

function buildMetaCardHTML(info) {
    const hasTitle = Boolean(info && info.title && String(info.title).trim());
    const hasAuthor = Boolean(info && info.author && info.author.nickname);
    if (!hasTitle && !hasAuthor) return "";

    let metaRows = "";
    if (hasTitle) {
        metaRows += `<div class="metaRow">
                        <div class="bioHeader">
                            <b>Bio / Judul:</b>
                            <button type="button" class="copyBioBtn" onclick="copyBio()">📝 Salin Bio</button>
                        </div>
                        <div class="bioText">${escapeHTML(info.title)}</div>
                     </div>`;
    }
    if (hasAuthor) {
        metaRows += `<div class="metaRow"><b>Pembuat:</b> ${escapeHTML(info.author.nickname)}</div>`;
    }
    return `<div class="metaCard">${metaRows}</div>`;
}

function normalizeTikTokPayload(payload) {
    if (!payload || typeof payload !== "object") return null;

    if (payload.code === 0 && payload.data) {
        if (Array.isArray(payload.data.videos) && payload.data.videos.length > 0) {
            return payload.data.videos[0];
        }
        if (payload.data.play || payload.data.hdplay || (Array.isArray(payload.data.images) && payload.data.images.length > 0)) {
            return payload.data;
        }
    }

    return null;
}

async function fetchJsonWithTimeout(endpointUrl, timeoutMs = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(endpointUrl, {
            signal: controller.signal,
            headers: { "Accept": "application/json" }
        });
        if (!res.ok) {
            const err = new Error(`HTTP_${res.status}`);
            err.statusCode = res.status;
            throw err;
        }
        return await res.json();
    } catch (err) {
        if (err && err.name === "AbortError") {
            const timeoutErr = new Error("TIMEOUT");
            timeoutErr.isTimeout = true;
            throw timeoutErr;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTikTokMediaWithFallback(url, statusEl) {
    let lastError = null;
    let sawUnavailableMedia = false;

    for (let i = 0; i < TIKTOK_API_ENDPOINTS.length; i++) {
        const endpoint = TIKTOK_API_ENDPOINTS[i];
        if (statusEl) {
            statusEl.textContent = i === 0
                ? `Menghubungi ${endpoint.name}...`
                : `Mencoba ${endpoint.name} (${i + 1}/${TIKTOK_API_ENDPOINTS.length})...`;
        }

        try {
            const rawData = await fetchJsonWithTimeout(endpoint.buildUrl(url), 9000);
            const normalized = normalizeTikTokPayload(rawData);

            if (normalized) {
                return { info: normalized, sourceName: endpoint.name };
            }

            if (rawData && rawData.code !== 0 && rawData.msg) {
                const msgLower = String(rawData.msg).toLowerCase();
                if (msgLower.includes("private") || msgLower.includes("not found") || msgLower.includes("deleted") || msgLower.includes("url")) {
                    sawUnavailableMedia = true;
                }
                lastError = new Error(rawData.msg);
            } else {
                lastError = new Error("EMPTY_MEDIA_DATA");
            }
        } catch (err) {
            lastError = err;
        }
    }

    if (sawUnavailableMedia) {
        throw new Error("Konten tidak ditemukan, bersifat privat, atau sudah dihapus oleh pembuatnya.");
    }
    if (lastError && lastError.isTimeout) {
        throw new Error("Waktu permintaan habis (timeout). Semua server API sedang sibuk atau jaringan lambat.");
    }
    if (lastError && lastError.statusCode === 429) {
        throw new Error("Batas permintaan sementara tercapai (rate limit). Coba lagi beberapa saat lagi.");
    }
    if (lastError && lastError.message && lastError.message.startsWith("HTTP_")) {
        throw new Error(`Server media merespons dengan galat (${lastError.message.replace("HTTP_", "HTTP ")}).`);
    }
    if (lastError && lastError.message === "EMPTY_MEDIA_DATA") {
        throw new Error("Data video atau foto kosong pada respons server.");
    }
    throw new Error("Gagal terhubung ke seluruh server API. Periksa koneksi internet Anda lalu coba lagi.");
}

function toggleUpdatesList() {
    const items = document.querySelectorAll("#updateList .update-item.collapsed-item, #updateList .update-item.expanded-item");
    const btn = document.getElementById("toggleUpdatesBtn");
    if (!btn) return;
    const isExpanded = btn.dataset.expanded === "true";

    items.forEach(item => {
        if (isExpanded) {
            item.classList.remove("expanded-item");
            item.classList.add("collapsed-item");
        } else {
            item.classList.remove("collapsed-item");
            item.classList.add("expanded-item");
        }
    });

    const totalItems = document.querySelectorAll("#updateList .update-item").length;
    btn.dataset.expanded = String(!isExpanded);
    btn.textContent = !isExpanded ? "Ringkas" : `Lihat Semua (${totalItems})`;
}

function syncPhotoSelectionUI() {
    const checkboxes = document.querySelectorAll(".photo-select-cb");
    let selectedCount = 0;

    checkboxes.forEach(cb => {
        const tile = cb.closest(".photoTile");
        if (cb.checked) {
            selectedCount++;
            if (tile) tile.classList.add("selected");
        } else {
            if (tile) tile.classList.remove("selected");
        }
    });

    const countLabel = document.getElementById("selectedPhotosCount");
    if (countLabel) {
        countLabel.textContent = `${selectedCount} / ${checkboxes.length} dipilih`;
    }

    const selectedBtn = document.getElementById("downloadSelectedPhotosBtn");
    if (selectedBtn) {
        selectedBtn.textContent = `✅ Unduh Terpilih (${selectedCount})`;
    }
}

function togglePhotoSelection(index) {
    const cb = document.getElementById(`photoCb_${index}`);
    if (!cb) return;
    cb.checked = !cb.checked;
    syncPhotoSelectionUI();
}

function setAllPhotosSelection(checked) {
    const checkboxes = document.querySelectorAll(".photo-select-cb");
    checkboxes.forEach(cb => {
        cb.checked = checked;
    });
    syncPhotoSelectionUI();
}

async function pasteURL() {
    const input = document.getElementById("urlInput");
    clearError();
    if (!input) return;
    try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
            input.value = text.trim();
            syncClearButton();
            input.focus();
            showToast("Link ditempel dari clipboard", "copy");
        } else {
            input.focus();
            showToast("Clipboard kosong", "progress");
        }
    } catch {
        input.focus();
        showToast("Tekan & tahan kolom input untuk menempel link", "progress");
    }
}

async function processURL() {
    const input = document.getElementById("urlInput");
    const checkBtn = document.getElementById("checkBtn");
    const loading = document.getElementById("loading");
    const loadingStatus = document.getElementById("loadingStatus");
    const result = document.getElementById("result");
    if (!input || !checkBtn || !loading || !result) return;

    const url = input.value.trim();

    clearError();
    result.classList.remove("show");
    currentBioText = "";
    currentCarouselImages = [];

    if (!url) {
        showError("Silakan tempel atau masukkan link TikTok terlebih dahulu.");
        input.focus();
        return;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        showError("Format link tidak valid. Link harus diawali http:// atau https://.");
        input.focus();
        return;
    }

    currentURL = url;

    if (!url.toLowerCase().includes("tiktok.com") && !url.toLowerCase().includes("vm.tiktok.com")) {
        showError("Link bukan dari TikTok. Masukkan link video atau foto TikTok yang valid.");
        input.focus();
        return;
    }

    checkBtn.disabled = true;
    if (loadingStatus) loadingStatus.textContent = "";
    loading.style.display = "block";

    try {
        const { info } = await fetchTikTokMediaWithFallback(url, loadingStatus);

        loading.style.display = "none";
        if (loadingStatus) loadingStatus.textContent = "";
        const platformEl = document.getElementById("platformName");
        if (platformEl) platformEl.textContent = "TikTok";

        currentBioText = info && info.title ? String(info.title).trim() : "";
        const filePrefix = buildYanzDownloadPrefix(info, url);

        let html = "";
        let actionButtons = "";

        if (info.images && info.images.length > 0) {
            currentCarouselImages = info.images.slice();
            currentDownloadPrefix = filePrefix;

            html += `<div class="mediaStage">`;
            html += `<div class="mediaStageHeader"><span>🖼️ Slide Foto Carousel</span><span>${info.images.length} Foto</span></div>`;
            html += `<div class="selectionToolbar">
                        <span class="selectionCount" id="selectedPhotosCount">${info.images.length} / ${info.images.length} dipilih</span>
                        <div class="selectionActions">
                            <button type="button" class="miniSelectBtn" onclick="setAllPhotosSelection(true)">Pilih Semua</button>
                            <button type="button" class="miniSelectBtn" onclick="setAllPhotosSelection(false)">Batal Pilih</button>
                        </div>
                     </div>`;
            html += `<div class="photoGrid">`;

            info.images.forEach((imgUrl, index) => {
                html += `<div class="photoTile selected" id="photoTile_${index}">
                            <label class="photoCheckWrap" title="Pilih foto ${index + 1}">
                                <input type="checkbox" id="photoCb_${index}" class="photo-select-cb" checked onchange="syncPhotoSelectionUI()">
                            </label>
                            <img src="${escapeAttribute(imgUrl)}" alt="Foto ${index + 1}" loading="lazy" onclick="togglePhotoSelection(${index})">
                            <button type="button" onclick="downloadFileDirectly('${escapeAttribute(imgUrl)}', '${escapeAttribute(filePrefix)}_foto_${index + 1}.jpg', 'photo', this)">Unduh #${index + 1}</button>
                         </div>`;
            });
            html += `</div></div>`;

            html += buildMetaCardHTML(info);

            actionButtons += `<button type="button" id="downloadSelectedPhotosBtn" class="primary" onclick="downloadSelectedPhotos(this)">✅ Unduh Terpilih (${info.images.length})</button>`;
            actionButtons += `<button type="button" class="photo-btn" onclick="downloadAllPhotos(currentCarouselImages, currentDownloadPrefix, this)">📸 Unduh Semua Foto</button>`;
            if (info.music) {
                actionButtons += `<button type="button" class="mp3-btn" onclick="downloadFileDirectly('${escapeAttribute(info.music)}', '${escapeAttribute(filePrefix)}_Audio.mp3', 'music', this)">🎵 Download MP3</button>`;
            }
            actionButtons += `<button type="button" class="secondary" onclick="copyURL()">Salin Link</button>`;
        } else {
            const { normalUrl, hdUrl, musicUrl, hasDistinctHd } = resolveBestMediaSources(info);
            const previewUrl = hasDistinctHd ? hdUrl : normalUrl;
            const qualityBadge = hasDistinctHd ? "HD Terpisah Tersedia" : "HD Mengikuti Sumber";

            html += `
                <div class="mediaStage">
                    <div class="mediaStageHeader"><span>🎬 Pratinjau Video</span><span>${qualityBadge}</span></div>
                    <div class="videoFrame">
                        <video controls controlsList="nodownload" preload="metadata" poster="${escapeAttribute(info.cover || '')}">
                            <source src="${escapeAttribute(previewUrl)}" type="video/mp4">
                            Browser Anda tidak mendukung pemutar video.
                        </video>
                    </div>
                </div>
            `;

            html += buildMetaCardHTML(info);

            actionButtons += `<button type="button" class="hd-btn" onclick="downloadFileDirectly('${escapeAttribute(hdUrl)}', '${escapeAttribute(filePrefix)}_HD.mp4', 'video_hd', this)">✨ Download HD</button>`;
            actionButtons += `<button type="button" class="primary" onclick="downloadFileDirectly('${escapeAttribute(normalUrl)}', '${escapeAttribute(filePrefix)}_Normal.mp4', 'video', this)">⬇️ Download Normal</button>`;
            actionButtons += `<button type="button" class="mp3-btn" onclick="downloadFileDirectly('${escapeAttribute(musicUrl)}', '${escapeAttribute(filePrefix)}_Audio.mp3', 'music', this)">🎵 Download MP3</button>`;
            actionButtons += `<button type="button" class="secondary" onclick="copyURL()">Salin Link</button>`;
        }

        const resultInfo = document.getElementById("resultInfo");
        const actionRow = document.getElementById("actionRowContainer");
        if (resultInfo) resultInfo.innerHTML = html;
        if (actionRow) actionRow.innerHTML = actionButtons;

        result.classList.add("show");
        if (info.images && info.images.length > 0) {
            syncPhotoSelectionUI();
        }
    } catch (error) {
        loading.style.display = "none";
        if (loadingStatus) loadingStatus.textContent = "";
        showError(error && error.message ? error.message : "Gagal memuat preview media. Silakan coba lagi.");
    } finally {
        checkBtn.disabled = false;
    }
}

async function downloadFileDirectly(fileUrl, filename, fileType, btnElement = null) {
    if (!fileUrl) {
        showError("Tautan file unduhan tidak tersedia.");
        return;
    }

    const doneMessage = fileType === "music"
        ? "Musik telah di download"
        : fileType === "photo"
            ? "Foto telah di download"
            : fileType === "video_hd"
                ? "Video HD telah di download"
                : "Video telah di download";

    const originalText = btnElement ? btnElement.textContent : "";
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.textContent = "⏳ Menyiapkan...";
    }
    showToast(fileType === "video_hd" ? "Menyiapkan video HD..." : "Menyiapkan file...", "progress");

    try {
        const response = await fetch(fileUrl, { mode: "cors" });
        if (!response.ok) throw new Error("Blob fetch gagal");
        const blob = await response.blob();
        if (!blob || blob.size === 0) throw new Error("Blob kosong");

        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = blobUrl;
        a.download = filename;

        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 300);

        showToast(doneMessage, "success");
    } catch (e) {
        const a = document.createElement("a");
        a.href = fileUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        showToast("Membuka tautan media langsung", "progress");
    } finally {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.textContent = originalText;
        }
    }
}

async function downloadSelectedPhotos(btnElement = null) {
    clearError();
    const checkboxes = document.querySelectorAll(".photo-select-cb");
    const chosen = [];

    checkboxes.forEach((cb, idx) => {
        if (cb.checked && currentCarouselImages[idx]) {
            chosen.push({ url: currentCarouselImages[idx], index: idx });
        }
    });

    if (chosen.length === 0) {
        showError("Pilih minimal satu foto terlebih dahulu sebelum mengunduh.");
        showToast("Belum ada foto yang dipilih", "progress");
        return;
    }

    const originalText = btnElement ? btnElement.textContent : "";
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.textContent = `⏳ Mengunduh (${chosen.length})...`;
    }
    showToast(`Menyiapkan ${chosen.length} foto terpilih...`, "progress");

    for (let i = 0; i < chosen.length; i++) {
        const item = chosen[i];
        await downloadFileDirectly(item.url, `${currentDownloadPrefix}_foto_${item.index + 1}.jpg`, "photo");
        if (i < chosen.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    }

    if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = originalText;
    }
    syncPhotoSelectionUI();
}

async function downloadAllPhotos(imagesArray, basePrefix, btnElement = null) {
    if (!imagesArray || imagesArray.length === 0) return;
    const prefix = basePrefix || "yanzdl_media";
    const originalText = btnElement ? btnElement.textContent : "";
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.textContent = "⏳ Mengunduh...";
    }
    showToast("Menyiapkan semua foto...", "progress");
    for (let i = 0; i < imagesArray.length; i++) {
        await downloadFileDirectly(imagesArray[i], `${prefix}_foto_${i + 1}.jpg`, "photo");
        if (i < imagesArray.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 450));
        }
    }
    if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = originalText;
    }
}

async function copyBio() {
    if (!currentBioText) {
        showError("Tidak ada teks bio untuk disalin.");
        return;
    }
    try {
        await navigator.clipboard.writeText(currentBioText);
        showToast("Bio sudah di salin", "copy");
    } catch {
        prompt("Salin bio berikut:", currentBioText);
    }
}

async function copyURL() {
    if (!currentURL) {
        showError("Tidak ada link untuk disalin.");
        return;
    }
    try {
        await navigator.clipboard.writeText(currentURL);
        showToast("Link sudah di salin", "copy");
    } catch {
        prompt("Salin link berikut:", currentURL);
    }
}

function showAbout() {
    const modal = document.getElementById("modal");
    if (modal) modal.classList.add("show");
}

function closeAbout() {
    const modal = document.getElementById("modal");
    if (modal) modal.classList.remove("show");
}

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
    return String(value)
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", () => {
    const urlInput = document.getElementById("urlInput");
    const modal = document.getElementById("modal");

    if (urlInput) {
        urlInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                processURL();
            }
        });
    }

    if (modal) {
        modal.addEventListener("click", function (event) {
            if (event.target === modal) {
                closeAbout();
            }
        });
    }
});
