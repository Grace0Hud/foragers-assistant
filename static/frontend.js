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


// ── Generic tag pill management ───────────────────────────────────────────────
// Used by both the upload form and the edit-tags modal.

function makePillManager(pillBoxId, textInputId, hiddenId, maxTags) {
    let tags = [];

    function render() {
        const box   = document.getElementById(pillBoxId);
        const input = document.getElementById(textInputId);
        if (!box || !input) return;

        box.querySelectorAll(".tag-pill").forEach(el => el.remove());

        tags.forEach((tag, i) => {
            const pill = document.createElement("span");
            pill.className = "tag-pill";
            pill.innerHTML = `${tag} <button type="button" aria-label="Remove ${tag}">&times;</button>`;
            pill.querySelector("button").addEventListener("click", () => {
                tags.splice(i, 1);
                render();
            });
            box.insertBefore(pill, input);
        });

        const hidden = document.getElementById(hiddenId);
        if (hidden) hidden.value = tags.join(",");

        input.style.display = tags.length >= maxTags ? "none" : "";
        input.placeholder = tags.length === 0 ? "Type a tag and press Enter or comma…" : "Add another tag…";
    }

    function addFromInput() {
        const input = document.getElementById(textInputId);
        if (!input) return;
        const raw = sanitizeInput(input.value).toLowerCase().replace(/,/g, "").trim();
        if (!raw) return;
        if (!validateTag(raw)) {
            input.style.borderBottom = "2px solid #C06E52";
            setTimeout(() => input.style.borderBottom = "", 1000);
            input.value = "";
            return;
        }
        if (tags.includes(raw) || tags.length >= maxTags) { input.value = ""; return; }
        tags.push(raw);
        input.value = "";
        render();
    }

    function setTags(newTags) {
        tags = [...newTags];
        render();
    }

    function getTags() { return [...tags]; }

    function reset() { tags = []; render(); }

    return { render, addFromInput, setTags, getTags, reset };
}

// Instantiate one manager per pill context
const uploadPills = makePillManager("tagPillBox",     "tagTextInput",     "tagsHidden",     10);
const editPills   = makePillManager("editTagPillBox", "editTagTextInput", "editTagsHidden", 10);


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
            if (activeTags.length > 0) runSearch();
            else { feedPage = 1; feedExhausted = false; $("#resultsGrid").empty(); $("#searchStatus").text(""); loadFeedPage(); }
        });
        container.append(pill);
    });
}

function addSearchTag(tag) {
    const clean = sanitizeInput(tag).toLowerCase().trim();
    if (!validateTag(clean) || activeTags.includes(clean)) return;
    activeTags.push(clean);
    renderActiveTags();
    runSearch();
}


// ── Gallery: feed ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
let feedPage = 1, feedLoading = false, feedExhausted = false;

async function loadFeedPage() {
    if (feedLoading || feedExhausted) return;
    feedLoading = true;
    $("#feedLoader").text("Loading…");
    try {
        const res  = await fetch(`/gallery/feed?page=${feedPage}&limit=${PAGE_SIZE}`);
        const data = await res.json();
        if (data.images && data.images.length > 0) { appendCards(data.images, "#resultsGrid"); feedPage++; }
        if (!data.has_more) {
            feedExhausted = true;
            $("#feedLoader").text(data.total > 0 ? "" : "No submissions yet. Be the first to upload!");
        } else {
            $("#feedLoader").text("");
        }
    } catch (err) { console.error(err); $("#feedLoader").text("Failed to load — please refresh."); }
    feedLoading = false;
}


// ── Gallery: tag search ───────────────────────────────────────────────────────

async function runSearch() {
    feedExhausted = true;
    $("#searchStatus").text("Searching…");
    $("#resultsGrid").empty();
    $("#feedLoader").text("");
    try {
        const params   = activeTags.map(t => `tags=${encodeURIComponent(t)}`).join("&");
        const response = await fetch(`/gallery/search?${params}`);
        if (!response.ok) { $("#searchStatus").text("Search failed."); return; }
        const data = await response.json();
        if (!data.images || data.images.length === 0) {
            $("#searchStatus").text(`No images found for "${activeTags.join(" + ")}".`);
            return;
        }
        $("#searchStatus").text(`Found ${data.images.length} image(s) for "${activeTags.join(" + ")}".`);
        appendCards(data.images, "#resultsGrid");
    } catch (err) { console.error(err); $("#searchStatus").text("Network error occurred."); }
}


// ── Shared card renderer ──────────────────────────────────────────────────────

function appendCards(items, gridSelector) {
    const grid = $(gridSelector);
    items.forEach(item => {
        const tagPills = (item.tags || []).slice(0, 3).map(t => `<span class="card-tag">${t}</span>`).join("");
        const card = $(`
            <div class="grid-card" tabindex="0" role="button" aria-label="View details">
                <img src="/uploads/${encodeURIComponent(item.image)}" alt="Tagged ${(item.tags || []).join(', ')}">
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
        if (entries[0].isIntersecting && activeTags.length === 0) loadFeedPage();
    }, { rootMargin: "200px" });
    observer.observe(sentinel);
}


// ── Detail modal ──────────────────────────────────────────────────────────────

function openDetail(item) {
    const activeTagSet = new Set(activeTags);
    $("#detailImg").attr("src", `/uploads/${encodeURIComponent(item.image)}`).attr("alt", (item.tags || []).join(", "));

    const tagsEl = $("#detailTags").empty();
    (item.tags || []).forEach(tag => {
        const pill = $(`<span class="detail-tag-pill${activeTagSet.has(tag) ? " active-tag" : ""}">${tag}</span>`);
        pill.on("click", () => { addSearchTag(tag); pill.addClass("active-tag"); });
        tagsEl.append(pill);
    });

    const locationText = [item.manual_address, item.location_label].filter(Boolean).join(" — ");
    if (locationText) { $("#detailLocationLabel").text(locationText); $("#detailLocationLabelRow").show(); }
    else { $("#detailLocationLabelRow").hide(); }

    const geo = item.location_geo;
    if (geo && geo.latitude != null && geo.longitude != null) {
        $("#detailCoordsLink").attr("href", `https://www.google.com/maps/dir/?api=1&destination=${geo.latitude},${geo.longitude}`);
        $("#detailCoordsText").text(`${geo.latitude}, ${geo.longitude}`);
        $("#detailCoordsRow").show();
    } else { $("#detailCoordsRow").hide(); }

    const road = item.nearest_road;
    if (road) {
        let roadText = `${road.type_label || road.type}`;
        if (road.name && road.name !== road.type_label) roadText += ` — ${road.name}`;
        if (road.distance_metres != null) {
            roadText += ` (${road.distance_metres < 1000
                ? road.distance_metres + " m away"
                : (road.distance_metres / 1000).toFixed(2) + " km away"})`;
        }
        $("#detailRoad").text(roadText);
        $("#detailRoadRow").show();
    } else { $("#detailRoadRow").hide(); }

    if (item.uploaded_at) $("#detailUploadedAt").text(new Date(item.uploaded_at).toLocaleString());
    else $("#detailUploadedAt").text("Unknown");

    $("#detailOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeDetail() { $("#detailOverlay").removeClass("open"); document.body.style.overflow = ""; }


// ── Upload modal ──────────────────────────────────────────────────────────────

let exifCoords = null;

function openUploadModal() {
    uploadPills.reset();
    $("#uploadForm")[0].reset();
    $("#tagsHidden").val("");
    $("#geoStatus").text("");
    $("#latitude, #longitude, #geo_source").val("");
    $("#autoLocationSection").show();
    $("#manualLocationSection").hide();
    $("#locModeAuto").prop("checked", true);
    $("#uploadError").hide();
    exifCoords = null;
    $("#uploadOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeUploadModal() { $("#uploadOverlay").removeClass("open"); document.body.style.overflow = ""; }


// ── Address geocoding ─────────────────────────────────────────────────────────

async function geocodeAddress(address) {
    try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
            { headers: { "Accept-Language": "en", "User-Agent": "ForagersAssistant/1.0" } });
        const data = await res.json();
        if (data && data.length > 0)
            return { latitude: parseFloat(data[0].lat).toFixed(7), longitude: parseFloat(data[0].lon).toFixed(7) };
    } catch (_) {}
    return null;
}


// ── EXIF GPS extraction ───────────────────────────────────────────────────────

function extractExifGps(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const buf = e.target.result, view = new DataView(buf);
                if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }
                let offset = 2;
                while (offset < view.byteLength - 2) {
                    const marker = view.getUint16(offset); offset += 2;
                    if (marker === 0xFFE1) {
                        const exifStr = String.fromCharCode(view.getUint8(offset+2),view.getUint8(offset+3),view.getUint8(offset+4),view.getUint8(offset+5));
                        if (exifStr !== "Exif") { resolve(null); return; }
                        const ts = offset + 8, le = view.getUint16(ts) === 0x4949;
                        const g16 = o => view.getUint16(ts+o,le), g32 = o => view.getUint32(ts+o,le);
                        const ifd0 = g32(4); let gpsOff = null;
                        for (let i = 0; i < g16(ifd0); i++) { const eo = ifd0+2+i*12; if (g16(eo)===0x8825){gpsOff=g32(eo+8);break;} }
                        if (!gpsOff) { resolve(null); return; }
                        const gps = {};
                        for (let i = 0; i < g16(gpsOff); i++) {
                            const eo = gpsOff+2+i*12, tag = g16(eo), vo = eo+8;
                            if (tag===1||tag===3) gps[tag]=String.fromCharCode(view.getUint8(ts+g32(vo)));
                            if (tag===2||tag===4){const d=g32(vo); gps[tag]=g32(d)/g32(d+4)+g32(d+8)/g32(d+12)/60+g32(d+16)/g32(d+20)/3600;}
                        }
                        if (gps[2]!=null&&gps[4]!=null) {
                            let lat=gps[2],lon=gps[4];
                            if(gps[1]==="S")lat=-lat; if(gps[3]==="W")lon=-lon;
                            resolve({latitude:lat.toFixed(7),longitude:lon.toFixed(7)}); return;
                        }
                        resolve(null); return;
                    }
                    if ((marker&0xFF00)!==0xFF00){resolve(null);return;}
                    offset+=view.getUint16(offset);
                }
                resolve(null);
            } catch(_){resolve(null);}
        };
        reader.onerror=()=>resolve(null);
        reader.readAsArrayBuffer(file.slice(0,131072));
    });
}

function getBrowserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation){resolve(null);return;}
        navigator.geolocation.getCurrentPosition(
            p=>resolve({latitude:p.coords.latitude.toFixed(7),longitude:p.coords.longitude.toFixed(7)}),
            ()=>resolve(null),{timeout:8000}
        );
    });
}


// ── My Uploads page ───────────────────────────────────────────────────────────

let pendingDeleteId = null;

async function loadMyUploads() {
    try {
        const res  = await fetch("/my-uploads/feed");
        const data = await res.json();

        $("#myUploadsStatus").text(data.images.length === 0 ? "You haven't uploaded anything yet." : "");

        data.images.forEach(item => {
            const tagPills = (item.tags || []).map(t => `<span class="my-card-tag">${t}</span>`).join("");
            const dateStr  = item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString() : "";

            const card = $(`
                <div class="my-card" data-id="${item._id}">
                    <img src="/uploads/${encodeURIComponent(item.image)}" alt="${(item.tags||[]).join(', ')}">
                    <div class="my-card-body">
                        <div class="my-card-tags">${tagPills}</div>
                        <div class="my-card-date">${dateStr}</div>
                    </div>
                    <div class="my-card-actions">
                        <button class="btn-edit">Edit Tags</button>
                        <button class="btn-delete">Delete</button>
                    </div>
                </div>
            `);

            card.find(".btn-edit").on("click", () => openEditModal(item._id, item.tags || []));
            card.find(".btn-delete").on("click", () => openDeleteConfirm(item._id));

            $("#myUploadsGrid").append(card);
        });
    } catch (err) {
        console.error(err);
        $("#myUploadsStatus").text("Failed to load uploads.");
    }
}

function openEditModal(docId, currentTags) {
    editPills.setTags(currentTags);
    $("#editDocId").val(docId);
    $("#editError").hide();
    $("#editOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeEditModal() { $("#editOverlay").removeClass("open"); document.body.style.overflow = ""; }

function openDeleteConfirm(docId) {
    pendingDeleteId = docId;
    $("#deleteOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeDeleteConfirm() { $("#deleteOverlay").removeClass("open"); document.body.style.overflow = ""; pendingDeleteId = null; }


// ── Page init ─────────────────────────────────────────────────────────────────

$(function () {

    // Escape key closes any open modal
    $(document).on("keydown", function (e) {
        if (e.key !== "Escape") return;
        closeDetail(); closeUploadModal(); closeEditModal(); closeDeleteConfirm();
    });

    // ── Gallery page ──────────────────────────────────────────────────────────
    if (document.getElementById("resultsGrid")) {

        loadFeedPage();
        initInfiniteScroll();

        // Search tag input
        $("#tag_input").on("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); const v=$(this).val().trim(); if(v){addSearchTag(v);$(this).val("");} }
        }).on("input", function () { if(this.value.includes(",")){addSearchTag(this.value);$(this).val("");} });

        $("#searchForm").on("submit", function (e) {
            e.preventDefault();
            const v = $("#tag_input").val().trim();
            if (v) { addSearchTag(v); $("#tag_input").val(""); }
            else if (activeTags.length > 0) runSearch();
        });

        // Detail modal
        $("#detailOverlay").on("click", function(e){if(e.target===this)closeDetail();});
        $("#detailClose").on("click", closeDetail);

        // Upload modal
        $("#navUploadBtn").on("click", openUploadModal);
        $("#uploadOverlay").on("click", function(e){if(e.target===this)closeUploadModal();});
        $("#uploadPanelClose").on("click", closeUploadModal);

        // Location mode toggle
        $("input[name='location_mode']").on("change", function () {
            if (this.value === "auto") { $("#autoLocationSection").show(); $("#manualLocationSection").hide(); }
            else { $("#autoLocationSection").hide(); $("#manualLocationSection").show(); $("#geoStatus").text(""); }
        });

        // EXIF on file select
        $("#imageInput").on("change", async function () {
            const file = this.files[0]; if (!file) return;
            if ($("#locModeAuto").is(":checked")) {
                exifCoords = await extractExifGps(file);
                $("#geoStatus").text(exifCoords
                    ? `📍 GPS found in photo (${exifCoords.latitude}, ${exifCoords.longitude})`
                    : "No GPS data in photo — will try device location on upload.");
            }
        });

        // Tag pill input (upload form)
        $("#tagPillBox").on("click", ()=>$("#tagTextInput").focus());
        $("#tagTextInput").on("keydown", function(e){if(e.key==="Enter"){e.preventDefault();uploadPills.addFromInput();}})
                         .on("input", function(){if(this.value.includes(","))uploadPills.addFromInput();});

        // Upload form submit via fetch
        $("#uploadForm").on("submit", async function (e) {
            e.preventDefault();
            uploadPills.addFromInput();
            if (uploadPills.getTags().length === 0) { $("#uploadError").text("Please add at least one tag.").show(); return; }
            $("#uploadError").hide();

            const mode = $("input[name='location_mode']:checked").val();
            if (mode === "manual") {
                const address = sanitizeInput($("#manual_address").val().trim());
                if (address) {
                    $("#geoStatus").show().text("Looking up address…");
                    const coords = await geocodeAddress(address);
                    if (coords) { $("#latitude").val(coords.latitude); $("#longitude").val(coords.longitude); $("#geo_source").val("address"); $("#geoStatus").text(`📍 Found: ${coords.latitude}, ${coords.longitude}`); }
                    else { $("#latitude,#longitude,#geo_source").val(""); $("#geoStatus").show().text("Address not found — uploading without coordinates."); }
                }
            } else {
                if (exifCoords) { $("#latitude").val(exifCoords.latitude); $("#longitude").val(exifCoords.longitude); $("#geo_source").val("exif"); }
                else {
                    $("#geoStatus").text("Requesting device location…");
                    const bc = await getBrowserLocation();
                    if (bc) { $("#latitude").val(bc.latitude); $("#longitude").val(bc.longitude); $("#geo_source").val("browser"); $("#geoStatus").text(`📍 Using device location (${bc.latitude}, ${bc.longitude})`); }
                    else { $("#geoStatus").text("Location unavailable — uploading without coordinates."); }
                }
            }

            $("#location_label").val(sanitizeInput($("#location_label").val()));

            try {
                const res  = await fetch("/upload", { method: "POST", body: new FormData(this) });
                const json = await res.json();
                if (res.ok && json.ok) {
                    closeUploadModal();
                    feedPage = 1; feedExhausted = false;
                    $("#resultsGrid").empty(); $("#searchStatus").text("");
                    activeTags = []; renderActiveTags();
                    await loadFeedPage();
                } else { $("#uploadError").text(json.error || "Upload failed.").show(); }
            } catch (err) { console.error(err); $("#uploadError").text("Network error — please try again.").show(); }
        });
    }

    // ── My Uploads page ───────────────────────────────────────────────────────
    if (document.getElementById("myUploadsGrid")) {

        loadMyUploads();

        // Edit tag pill input
        $("#editTagPillBox").on("click", ()=>$("#editTagTextInput").focus());
        $("#editTagTextInput").on("keydown", function(e){if(e.key==="Enter"){e.preventDefault();editPills.addFromInput();}})
                              .on("input", function(){if(this.value.includes(","))editPills.addFromInput();});

        // Edit form submit
        $("#editForm").on("submit", async function (e) {
            e.preventDefault();
            editPills.addFromInput();
            const tags   = editPills.getTags();
            const docId  = $("#editDocId").val();
            if (tags.length === 0) { $("#editError").text("Please add at least one tag.").show(); return; }
            $("#editError").hide();

            try {
                const res  = await fetch(`/my-uploads/edit-tags/${docId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tags: tags.join(",") })
                });
                const json = await res.json();
                if (res.ok && json.ok) {
                    // Update the card's tag display in-place
                    const card    = $(`[data-id="${docId}"]`);
                    const newPills = json.tags.map(t => `<span class="my-card-tag">${t}</span>`).join("");
                    card.find(".my-card-tags").html(newPills);
                    closeEditModal();
                } else { $("#editError").text(json.error || "Save failed.").show(); }
            } catch (err) { console.error(err); $("#editError").text("Network error — please try again.").show(); }
        });

        // Edit modal close
        $("#editOverlay").on("click", function(e){if(e.target===this)closeEditModal();});
        $("#editPanelClose").on("click", closeEditModal);

        // Delete confirm
        $("#deleteCancelBtn").on("click", closeDeleteConfirm);
        $("#deleteOverlay").on("click", function(e){if(e.target===this)closeDeleteConfirm();});

        $("#deleteConfirmBtn").on("click", async function () {
            if (!pendingDeleteId) return;
            try {
                const res  = await fetch(`/my-uploads/delete/${pendingDeleteId}`, { method: "DELETE" });
                const json = await res.json();
                if (res.ok && json.ok) {
                    $(`[data-id="${pendingDeleteId}"]`).remove();
                    closeDeleteConfirm();
                    if ($("#myUploadsGrid").children().length === 0)
                        $("#myUploadsStatus").text("You haven't uploaded anything yet.");
                } else { alert(json.error || "Delete failed."); closeDeleteConfirm(); }
            } catch (err) { console.error(err); alert("Network error — please try again."); closeDeleteConfirm(); }
        });
    }
});