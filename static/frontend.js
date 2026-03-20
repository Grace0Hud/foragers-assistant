// ── Sanitization helpers ──────────────────────────────────────────────────────

function sanitizeInput(value) {
    if (typeof value !== "string") return "";
    const temp = document.createElement("div");
    temp.textContent = value;
    return temp.innerHTML.trim();
}

function validateTag(tag) {
    if (!tag || tag.length === 0 || tag.length > 128) return false;
    return /^[A-Za-z ]+$/.test(tag);
}


// ── Upload form: tag pill management ─────────────────────────────────────────

const MAX_UPLOAD_TAGS = 10;
let uploadTags = [];

function renderUploadTags() {
    const box   = document.getElementById("tagPillBox");
    const input = document.getElementById("tagTextInput");
    if (!box) return;

    box.querySelectorAll(".tag-pill").forEach(el => el.remove());

    uploadTags.forEach((tag, index) => {
        const pill = document.createElement("span");
        pill.className = "tag-pill";
        pill.innerHTML = `${tag} <button type="button" aria-label="Remove ${tag}">&times;</button>`;
        pill.querySelector("button").addEventListener("click", () => {
            uploadTags.splice(index, 1);
            renderUploadTags();
        });
        box.insertBefore(pill, input);
    });

    document.getElementById("tagsHidden").value = uploadTags.join(",");
    input.style.display = uploadTags.length >= MAX_UPLOAD_TAGS ? "none" : "";
    input.placeholder = uploadTags.length === 0
        ? "Type a tag and press Enter or comma…"
        : "Add another tag…";
}

function addUploadTagFromInput() {
    const input = document.getElementById("tagTextInput");
    if (!input) return;
    const raw = sanitizeInput(input.value).toLowerCase().replace(/,/g, "").trim();
    if (!raw) return;
    if (!validateTag(raw)) {
        input.style.borderBottom = "2px solid #C06E52";
        setTimeout(() => input.style.borderBottom = "", 1000);
        input.value = "";
        return;
    }
    if (uploadTags.includes(raw) || uploadTags.length >= MAX_UPLOAD_TAGS) {
        input.value = "";
        return;
    }
    uploadTags.push(raw);
    input.value = "";
    renderUploadTags();
}

function resetUploadForm() {
    uploadTags = [];
    renderUploadTags();
    document.getElementById("uploadForm").reset();
    document.getElementById("tagsHidden").value = "";
    document.getElementById("geoStatus").textContent = "";
    document.getElementById("latitude").value = "";
    document.getElementById("longitude").value = "";
    document.getElementById("geo_source").value = "";
    document.getElementById("autoLocationSection").style.display = "";
    document.getElementById("manualLocationSection").style.display = "none";
    document.getElementById("locModeAuto").checked = true;
    document.getElementById("uploadError").style.display = "none";
    exifCoords = null;
}


// ── Gallery: active search tags ───────────────────────────────────────────────

let activeTags = [];

function renderActiveTags() {
    const container = $("#activeTags");
    container.empty();
    activeTags.forEach(tag => {
        const pill = $(`<span class="search-tag-pill">${tag} <button type="button" aria-label="Remove ${tag}">&times;</button></span>`);
        pill.find("button").on("click", () => {
            activeTags = activeTags.filter(t => t !== tag);
            renderActiveTags();
            if (activeTags.length > 0) {
                runSearch();
            } else {
                // Back to feed mode
                feedPage = 1;
                feedExhausted = false;
                $("#resultsGrid").empty();
                $("#searchStatus").text("");
                loadFeedPage();
            }
        });
        container.append(pill);
    });
}

function addSearchTag(tag) {
    const clean = sanitizeInput(tag).toLowerCase().trim();
    if (!validateTag(clean)) return;
    if (activeTags.includes(clean)) return;
    activeTags.push(clean);
    renderActiveTags();
    runSearch();
}


// ── Gallery: feed (no tags) ───────────────────────────────────────────────────

const PAGE_SIZE   = 20;
let   feedPage    = 1;
let   feedLoading = false;
let   feedExhausted = false;

async function loadFeedPage() {
    if (feedLoading || feedExhausted) return;
    feedLoading = true;
    $("#feedLoader").text("Loading…");

    try {
        const res  = await fetch(`/gallery/feed?page=${feedPage}&limit=${PAGE_SIZE}`);
        const data = await res.json();

        if (data.images && data.images.length > 0) {
            appendCards(data.images);
            feedPage++;
        }

        if (!data.has_more) {
            feedExhausted = true;
            $("#feedLoader").text(data.total > 0 ? "" : "No submissions yet. Be the first to upload!");
        } else {
            $("#feedLoader").text("");
        }

    } catch (err) {
        console.error(err);
        $("#feedLoader").text("Failed to load — please refresh.");
    }

    feedLoading = false;
}


// ── Gallery: tag search (replaces feed) ──────────────────────────────────────

async function runSearch() {
    const status = $("#searchStatus");
    const grid   = $("#resultsGrid");

    // Switch to search mode: clear feed state
    feedExhausted = true;  // pause infinite scroll while in search mode
    status.text("Searching…");
    grid.empty();
    $("#feedLoader").text("");

    try {
        const params   = activeTags.map(t => `tags=${encodeURIComponent(t)}`).join("&");
        const response = await fetch(`/gallery/search?${params}`);

        if (!response.ok) { status.text("Search failed."); return; }

        const data = await response.json();

        if (!data.images || data.images.length === 0) {
            status.text(`No images found for "${activeTags.join(" + ")}".`);
            return;
        }

        status.text(`Found ${data.images.length} image(s) for "${activeTags.join(" + ")}".`);
        appendCards(data.images);

    } catch (err) {
        console.error(err);
        status.text("Network error occurred.");
    }
}


// ── Shared card renderer ──────────────────────────────────────────────────────

function appendCards(items) {
    const grid = $("#resultsGrid");
    items.forEach(item => {
        const tagPills = (item.tags || []).slice(0, 3)
            .map(t => `<span class="card-tag">${t}</span>`).join("");

        const card = $(`
            <div class="grid-card" tabindex="0" role="button" aria-label="View details">
                <img src="/uploads/${encodeURIComponent(item.image)}"
                     alt="Tagged ${(item.tags || []).join(', ')}">
                <div class="card-tag-strip">${tagPills}</div>
            </div>
        `);

        card.on("click keydown", function (e) {
            if (e.type === "keydown" && e.key !== "Enter") return;
            openDetail(item);
        });

        grid.append(card);
    });
}


// ── Infinite scroll ───────────────────────────────────────────────────────────

function initInfiniteScroll() {
    const sentinel = document.getElementById("feedSentinel");
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && activeTags.length === 0) {
            loadFeedPage();
        }
    }, { rootMargin: "200px" });

    observer.observe(sentinel);
}


// ── Detail modal ──────────────────────────────────────────────────────────────

function openDetail(item) {
    const activeTagSet = new Set(activeTags);

    $("#detailImg")
        .attr("src", `/uploads/${encodeURIComponent(item.image)}`)
        .attr("alt", (item.tags || []).join(", "));

    const tagsEl = $("#detailTags").empty();
    (item.tags || []).forEach(tag => {
        const pill = $(`<span class="detail-tag-pill${activeTagSet.has(tag) ? " active-tag" : ""}">${tag}</span>`);
        pill.on("click", () => {
            addSearchTag(tag);
            pill.addClass("active-tag");
        });
        tagsEl.append(pill);
    });

    const locationText = [item.manual_address, item.location_label].filter(Boolean).join(" — ");
    if (locationText) {
        $("#detailLocationLabel").text(locationText);
        $("#detailLocationLabelRow").show();
    } else {
        $("#detailLocationLabelRow").hide();
    }

    const geo = item.location_geo;
    if (geo && geo.latitude != null && geo.longitude != null) {
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${geo.latitude},${geo.longitude}`;
        $("#detailCoordsLink").attr("href", mapsUrl);
        $("#detailCoordsText").text(`${geo.latitude}, ${geo.longitude}`);
        $("#detailCoordsRow").show();
    } else {
        $("#detailCoordsRow").hide();
    }

    if (item.uploaded_at) {
        $("#detailUploadedAt").text(new Date(item.uploaded_at).toLocaleString());
    } else {
        $("#detailUploadedAt").text("Unknown");
    }

    $("#detailOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeDetail() {
    $("#detailOverlay").removeClass("open");
    document.body.style.overflow = "";
}


// ── Upload modal ──────────────────────────────────────────────────────────────

function openUploadModal() {
    resetUploadForm();
    $("#uploadOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeUploadModal() {
    $("#uploadOverlay").removeClass("open");
    document.body.style.overflow = "";
}


// ── Address geocoding (Nominatim / OpenStreetMap) ─────────────────────────────

async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    try {
        const res  = await fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "ForagersAssistant/1.0" } });
        const data = await res.json();
        if (data && data.length > 0)
            return { latitude: parseFloat(data[0].lat).toFixed(7), longitude: parseFloat(data[0].lon).toFixed(7) };
        return null;
    } catch (_) { return null; }
}


// ── EXIF GPS extraction ───────────────────────────────────────────────────────

let exifCoords = null;

function extractExifGps(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const buf  = e.target.result;
                const view = new DataView(buf);
                if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }
                let offset = 2;
                while (offset < view.byteLength - 2) {
                    const marker = view.getUint16(offset);
                    offset += 2;
                    if (marker === 0xFFE1) {
                        const exifStr = String.fromCharCode(
                            view.getUint8(offset+2), view.getUint8(offset+3),
                            view.getUint8(offset+4), view.getUint8(offset+5)
                        );
                        if (exifStr !== "Exif") { resolve(null); return; }
                        const tiffStart = offset + 8;
                        const littleEnd = view.getUint16(tiffStart) === 0x4949;
                        const getU16 = o => view.getUint16(tiffStart + o, littleEnd);
                        const getU32 = o => view.getUint32(tiffStart + o, littleEnd);
                        const ifd0   = getU32(4);
                        let gpsOff   = null;
                        for (let i = 0; i < getU16(ifd0); i++) {
                            const eo = ifd0 + 2 + i * 12;
                            if (getU16(eo) === 0x8825) { gpsOff = getU32(eo + 8); break; }
                        }
                        if (!gpsOff) { resolve(null); return; }
                        const gps = {};
                        for (let i = 0; i < getU16(gpsOff); i++) {
                            const eo  = gpsOff + 2 + i * 12;
                            const tag = getU16(eo), vo = eo + 8;
                            if (tag === 1 || tag === 3)
                                gps[tag] = String.fromCharCode(view.getUint8(tiffStart + getU32(vo)));
                            if (tag === 2 || tag === 4) {
                                const d = getU32(vo);
                                gps[tag] = getU32(d)/getU32(d+4) + getU32(d+8)/getU32(d+12)/60 + getU32(d+16)/getU32(d+20)/3600;
                            }
                        }
                        if (gps[2] != null && gps[4] != null) {
                            let lat = gps[2], lon = gps[4];
                            if (gps[1] === "S") lat = -lat;
                            if (gps[3] === "W") lon = -lon;
                            resolve({ latitude: lat.toFixed(7), longitude: lon.toFixed(7) });
                            return;
                        }
                        resolve(null); return;
                    }
                    if ((marker & 0xFF00) !== 0xFF00) { resolve(null); return; }
                    offset += view.getUint16(offset);
                }
                resolve(null);
            } catch (_) { resolve(null); }
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file.slice(0, 131072));
    });
}


// ── Browser geolocation ───────────────────────────────────────────────────────

function getBrowserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ latitude: pos.coords.latitude.toFixed(7), longitude: pos.coords.longitude.toFixed(7) }),
            ()  => resolve(null),
            { timeout: 8000 }
        );
    });
}


// ── Page init ─────────────────────────────────────────────────────────────────

$(function () {

    // ── Gallery page ──────────────────────────────────────────────────────────
    if (document.getElementById("resultsGrid")) {

        // Load initial feed
        loadFeedPage();
        initInfiniteScroll();

        // Search: add tag on Enter or comma
        $("#tag_input").on("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                const val = $(this).val().trim();
                if (val) { addSearchTag(val); $(this).val(""); }
            }
        }).on("input", function () {
            if (this.value.includes(",")) {
                addSearchTag(this.value);
                $(this).val("");
            }
        });

        $("#searchForm").on("submit", function (e) {
            e.preventDefault();
            const val = $("#tag_input").val().trim();
            if (val) { addSearchTag(val); $("#tag_input").val(""); }
            else if (activeTags.length > 0) runSearch();
        });

        // Detail modal
        $("#detailOverlay").on("click", function (e) { if (e.target === this) closeDetail(); });
        $("#detailClose").on("click", closeDetail);
        $(document).on("keydown", function (e) { if (e.key === "Escape") { closeDetail(); closeUploadModal(); } });

        // FAB + upload modal
        $("#fabUpload").on("click", openUploadModal);
        $("#uploadOverlay").on("click", function (e) { if (e.target === this) closeUploadModal(); });
        $("#uploadPanelClose").on("click", closeUploadModal);

        // Location mode toggle
        $("input[name='location_mode']").on("change", function () {
            if (this.value === "auto") {
                $("#autoLocationSection").show();
                $("#manualLocationSection").hide();
            } else {
                $("#autoLocationSection").hide();
                $("#manualLocationSection").show();
                $("#geoStatus").text("");
            }
        });

        // EXIF read on file select
        $("#imageInput").on("change", async function () {
            const file = this.files[0];
            if (!file) return;
            if ($("#locModeAuto").is(":checked")) {
                exifCoords = await extractExifGps(file);
                $("#geoStatus").text(exifCoords
                    ? `📍 GPS found in photo (${exifCoords.latitude}, ${exifCoords.longitude})`
                    : "No GPS data in photo — will try device location on upload."
                );
            }
        });

        // Tag pill input
        $("#tagPillBox").on("click", () => $("#tagTextInput").focus());
        $("#tagTextInput").on("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); addUploadTagFromInput(); }
        }).on("input", function () {
            if (this.value.includes(",")) addUploadTagFromInput();
        });

        // Upload form submit — POST via fetch so we can close the modal on success
        $("#uploadForm").on("submit", async function (e) {
            e.preventDefault();
            addUploadTagFromInput();

            if (uploadTags.length === 0) {
                $("#uploadError").text("Please add at least one tag.").show();
                return;
            }
            $("#uploadError").hide();

            const mode = $("input[name='location_mode']:checked").val();

            if (mode === "manual") {
                const address = sanitizeInput($("#manual_address").val().trim());
                if (address) {
                    $("#geoStatus").show().text("Looking up address…");
                    const coords = await geocodeAddress(address);
                    if (coords) {
                        $("#latitude").val(coords.latitude);
                        $("#longitude").val(coords.longitude);
                        $("#geo_source").val("address");
                        $("#geoStatus").text(`📍 Found: ${coords.latitude}, ${coords.longitude}`);
                    } else {
                        $("#latitude").val("");
                        $("#longitude").val("");
                        $("#geo_source").val("");
                        $("#geoStatus").show().text("Address not found — uploading without coordinates.");
                    }
                }
            } else {
                if (exifCoords) {
                    $("#latitude").val(exifCoords.latitude);
                    $("#longitude").val(exifCoords.longitude);
                    $("#geo_source").val("exif");
                } else {
                    $("#geoStatus").text("Requesting device location…");
                    const bc = await getBrowserLocation();
                    if (bc) {
                        $("#latitude").val(bc.latitude);
                        $("#longitude").val(bc.longitude);
                        $("#geo_source").val("browser");
                        $("#geoStatus").text(`📍 Using device location (${bc.latitude}, ${bc.longitude})`);
                    } else {
                        $("#geoStatus").text("Location unavailable — uploading without coordinates.");
                    }
                }
            }

            // Sanitize location label
            $("#location_label").val(sanitizeInput($("#location_label").val()));

            // Submit via fetch — keeps us on the gallery page
            const formData = new FormData(this);
            try {
                const res = await fetch("/upload", { method: "POST", body: formData });
                const json = await res.json();

                if (res.ok && json.ok) {
                    closeUploadModal();
                    // Prepend the new item to the feed by reloading page 1
                    feedPage = 1;
                    feedExhausted = false;
                    $("#resultsGrid").empty();
                    $("#searchStatus").text("");
                    activeTags = [];
                    renderActiveTags();
                    await loadFeedPage();
                } else {
                    $("#uploadError").text(json.error || "Upload failed.").show();
                }
            } catch (err) {
                console.error(err);
                $("#uploadError").text("Network error — please try again.").show();
            }
        });
    }
});