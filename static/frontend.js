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
let nearbyFilter = {
    enabled: false,
    latitude: null,
    longitude: null,
    radiusKm: 25,
};

function renderActiveTags() {
    const container = $("#activeTags");
    container.empty();
    activeTags.forEach(tag => {
        const pill = $(`<span class="search-tag-pill">${tag} <button type="button" aria-label="Remove ${tag}">&times;</button></span>`);
        pill.find("button").on("click", () => {
            activeTags = activeTags.filter(t => t !== tag);
            renderActiveTags();
            refreshGalleryResults();
        });
        container.append(pill);
    });
}

function addSearchTag(tag) {
    const clean = sanitizeInput(tag).toLowerCase().trim();
    if (!validateTag(clean) || activeTags.includes(clean)) return;
    activeTags.push(clean);
    renderActiveTags();
    refreshGalleryResults();
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

        // Road warning badge — or address-not-found badge if geocoding failed
        const warn = item.nearest_road && item.nearest_road.road_warning;
        let badge = "";
        if (warn) {
            badge = `<span class="road-warning ${warn.level}">${warn.text}</span>`;
        } else if (hasNoAddress(item)) {
            badge = `<span class="road-warning addr">no address</span>`;
        }
        const distanceBadge = item.distance_km != null
            ? `<span class="distance-badge">${item.distance_km} km away</span>`
            : "";

        const card = $(`
            <div class="grid-card" tabindex="0" role="button" aria-label="View details">
                <img src="/uploads/${encodeURIComponent(item.image)}" alt="Tagged ${(item.tags || []).join(', ')}">
                ${badge}
                ${distanceBadge}
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
        if (entries[0].isIntersecting && activeTags.length === 0 && !nearbyFilter.enabled) loadFeedPage();
    }, { rootMargin: "200px" });
    observer.observe(sentinel);
}


// ── Detail modal ──────────────────────────────────────────────────────────────

function openDetail(item) {
    const activeTagSet = new Set(activeTags);
    $("#detailOverlay").data("postId", item._id || "");
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

    $("#detailAbuseReason").val("");
    $("#detailAbuseReason").prop("hidden", true);
    $("#reportAbuseBtn").text("Report Post");
    $("#detailAbuseMessage").text("");

    $("#detailOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function buildNearbyQuery() {
    const params = new URLSearchParams({
        latitude: nearbyFilter.latitude,
        longitude: nearbyFilter.longitude,
        radius_km: nearbyFilter.radiusKm,
    });
    activeTags.forEach(tag => params.append("tags", tag));
    return params.toString();
}

async function runNearbySearch() {
    feedExhausted = true;
    $("#resultsGrid").empty();
    $("#feedLoader").text("");
    $("#searchStatus").text("Finding nearby submissions...");
    try {
        const response = await fetch(`/gallery/nearby?${buildNearbyQuery()}`);
        const data = await response.json();
        if (!response.ok) {
            $("#searchStatus").text(data.error || "Nearby search failed.");
            return;
        }
        if (!data.images || data.images.length === 0) {
            $("#searchStatus").text(`No nearby foragables found within ${nearbyFilter.radiusKm} km.`);
            return;
        }
        $("#searchStatus").text(`Found ${data.images.length} nearby foragables within ${nearbyFilter.radiusKm} km.`);
        appendCards(data.images, "#resultsGrid");
    } catch (err) {
        console.error(err);
        $("#searchStatus").text("Network error occurred.");
    }
}

function refreshGalleryResults() {
    if (nearbyFilter.enabled && nearbyFilter.latitude != null && nearbyFilter.longitude != null) {
        runNearbySearch();
        return;
    }
    if (activeTags.length > 0) {
        runSearch();
        return;
    }
    feedPage = 1;
    feedExhausted = false;
    $("#resultsGrid").empty();
    $("#searchStatus").text("");
    $("#feedLoader").text("");
    loadFeedPage();
}

function closeDetail() { $("#detailOverlay").removeClass("open"); document.body.style.overflow = ""; }


// ── Upload modal ──────────────────────────────────────────────────────────────

let exifCoords = null;
const SLOW_ACTION_DELAY_MS = 8000;
let uploadBusy = false;
let uploadAbortController = null;
let uploadSlowActionTimer = null;
let uploadCanceled = false;
let myDetailBusy = false;
let myDetailAbortController = null;
let myDetailSlowActionTimer = null;
let myDetailCanceled = false;

function openUploadModal() {
    uploadPills.reset();
    $("#uploadForm")[0].reset();
    $("#tagsHidden").val("");
    $("#geoStatus").text("");
    $("#latitude, #longitude, #geo_source, #address_lookup_failed").val("");
    $("#autoLocationSection").show();
    $("#manualLocationSection").hide();
    $("#locModeAuto").prop("checked", true);
    $("#uploadError").hide();
    setUploadBusyState(false);
    exifCoords = null;
    $("#uploadOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeUploadModal() {
    if (uploadBusy) return;
    $("#uploadOverlay").removeClass("open");
    document.body.style.overflow = "";
}

function setUploadBusyState(isBusy, loadingText = "Uploading your post...") {
    uploadBusy = isBusy;
    $("#uploadPanel").toggleClass("is-busy", isBusy);
    $("#uploadOverlay").toggleClass("is-busy", isBusy);
    $("#uploadForm").find("input, button").prop("disabled", isBusy);
    $("#uploadPanelClose").prop("disabled", isBusy);
    $("#uploadLoadingText").text(loadingText);
    $("#uploadLoadingState").prop("hidden", !isBusy);
    $("#uploadCancelRequestBtn").prop("hidden", true).prop("disabled", !isBusy);
}

function startUploadSlowActionTimer() {
    clearTimeout(uploadSlowActionTimer);
    uploadSlowActionTimer = window.setTimeout(() => {
        if (!uploadBusy) return;
        $("#uploadLoadingText").text("This is taking longer than expected. You can keep waiting or cancel.");
        $("#uploadCancelRequestBtn").prop("hidden", false).prop("disabled", false);
    }, SLOW_ACTION_DELAY_MS);
}

function stopUploadSlowActionTimer() {
    clearTimeout(uploadSlowActionTimer);
    uploadSlowActionTimer = null;
}

function cancelUploadAction() {
    uploadCanceled = true;
    if (uploadAbortController) uploadAbortController.abort();
    stopUploadSlowActionTimer();
    setUploadBusyState(false);
    $("#uploadError").text("Upload canceled.").show();
}


// ── Address geocoding ─────────────────────────────────────────────────────────

async function geocodeAddress(address, options = {}) {
    try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
            {
                headers: { "Accept-Language": "en", "User-Agent": "ForagersAssistant/1.0" },
                signal: options.signal,
            });
        const data = await res.json();
        if (data && data.length > 0)
            return { latitude: parseFloat(data[0].lat).toFixed(7), longitude: parseFloat(data[0].lon).toFixed(7) };
    } catch (err) {
        if (err && err.name === "AbortError") throw err;
        console.error("Geocoding failed:", err);
    }
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

async function enableNearbyFilter() {
    $("#nearbyStatus").text("Requesting your location...");
    const location = await getBrowserLocation();
    if (!location) {
        $("#nearbyStatus").text("Could not get your location.");
        return;
    }
    nearbyFilter.enabled = true;
    nearbyFilter.latitude = location.latitude;
    nearbyFilter.longitude = location.longitude;
    nearbyFilter.radiusKm = parseFloat($("#radiusSelect").val() || "25");
    $("#clearNearbyBtn").prop("hidden", false);
    $("#nearbyStatus").text(`Showing posts within ${nearbyFilter.radiusKm} km of your location.`);
    refreshGalleryResults();
}

function clearNearbyFilter() {
    nearbyFilter.enabled = false;
    nearbyFilter.latitude = null;
    nearbyFilter.longitude = null;
    nearbyFilter.radiusKm = null;
    activeTags = [];
    renderActiveTags();
    $("#radiusSelect").val("");
    $("#clearNearbyBtn").prop("hidden", true);
    $("#nearbyStatus").text("");
    refreshGalleryResults();
}


// ── My Uploads page ───────────────────────────────────────────────────────────

async function loadMyUploads() {
    try {
        const res  = await fetch("/my-uploads/feed");
        const data = await res.json();

        $("#myUploadsGrid").empty();
        $("#myUploadsStatus").text(data.images.length === 0 ? "You haven't uploaded anything yet." : "");

        // Keep a lookup map so other handlers can find the full item by _id
        window._myUploadsMap = {};

        data.images.forEach(item => {
            window._myUploadsMap[item._id] = item;

            const tagPills = (item.tags || []).slice(0, 3).map(t => `<span class="card-tag">${t}</span>`).join("");

            const warn      = item.nearest_road && item.nearest_road.road_warning;
            let warnBadge = "";
            if (warn) {
                warnBadge = `<span class="road-warning ${warn.level}">${warn.text}</span>`;
            } else if (hasNoAddress(item)) {
                warnBadge = `<span class="road-warning addr">no address</span>`;
            }

            const card = $(`
                <div class="grid-card my-upload-card" data-id="${item._id}" tabindex="0" role="button" aria-label="View details">
                    <div class="my-card-img-wrap">
                        <img src="/uploads/${encodeURIComponent(item.image)}"
                             alt="${(item.tags||[]).join(', ')}">
                        ${warnBadge}
                    </div>
                    <div class="card-tag-strip">${tagPills}</div>
                </div>
            `);

            card.on("click keydown", function (e) {
                if (e.type === "keydown" && e.key !== "Enter") return;
                openMyDetail(item);
            });

            $("#myUploadsGrid").append(card);
        });
    } catch (err) {
        console.error(err);
        $("#myUploadsStatus").text("Failed to load uploads.");
    }
}

// Current item open in the detail modal — used by inline edit handlers
let myDetailItem = null;
let myDetailOriginalValues = null;

function arraysEqual(a = [], b = []) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function initializeMyDetailEditForm(item) {
    myDetailOriginalValues = {
        tags: [...(item.tags || [])],
        manual_address: item.manual_address || "",
        location_label: item.location_label || "",
        location_geo: item.location_geo ? { ...item.location_geo } : null
    };

    editPills.setTags(item.tags || []);
    $("#editAddressInput").val(item.manual_address || "");
    $("#editLocationInput").val(item.location_label || "");
    $("#editAddressStatus").text("");
}

function setMyDetailEditMode(isEditing) {
    $("#myDetailBody").toggleClass("is-editing", isEditing);
    $("#myDetailError").hide();
    if (!isEditing) $("#editAddressStatus").text("");
}

function renderMyDetail(item) {
    myDetailItem = item;

    $("#myDetailImg")
        .attr("src", `/uploads/${encodeURIComponent(item.image)}`)
        .attr("alt", (item.tags || []).join(", "));

    // Tags
    renderMyDetailTags(item.tags || []);

    // Address
    if (item.manual_address) {
        $("#myDetailAddress").text(item.manual_address);
        $("#myDetailAddressRow").show();
    } else {
        $("#myDetailAddress").text("None");
        $("#myDetailAddressRow").show();
    }

    // Location description
    if (item.location_label) {
        $("#myDetailLocationLabel").text(item.location_label);
        $("#myDetailLocationLabelRow").show();
    } else {
        $("#myDetailLocationLabel").text("None");
        $("#myDetailLocationLabelRow").show();
    }

    // Coordinates
    const geo = item.location_geo;
    if (geo && geo.latitude != null && geo.longitude != null) {
        $("#myDetailCoordsLink").attr("href",
            `https://www.google.com/maps/dir/?api=1&destination=${geo.latitude},${geo.longitude}`);
        $("#myDetailCoordsText").text(`${geo.latitude}, ${geo.longitude}`);
        $("#myDetailCoordsRow").show();
    } else {
        $("#myDetailCoordsRow").hide();
    }

    // Nearest road
    const road = item.nearest_road;
    if (road) {
        let roadText = road.type_label || road.type;
        if (road.name && road.name !== road.type_label) roadText += ` — ${road.name}`;
        if (road.distance_metres != null) {
            roadText += ` (${road.distance_metres < 1000
                ? road.distance_metres + " m away"
                : (road.distance_metres / 1000).toFixed(2) + " km away"})`;
        }
        $("#myDetailRoad").text(roadText);
        $("#myDetailRoadRow").show();
    } else {
        $("#myDetailRoadRow").hide();
    }

    $("#myDetailUploadedAt").text(
        item.uploaded_at ? new Date(item.uploaded_at).toLocaleString() : "Unknown"
    );

    initializeMyDetailEditForm(item);
    setMyDetailEditMode(false);
}

function renderMyDetailTags(tags) {
    const tagsEl = $("#myDetailTags").empty();
    tags.forEach(tag => tagsEl.append(`<span class="detail-tag-pill">${tag}</span>`));
}

function hasNoAddress(item) {
    if (!item) return true;
    const geo = item.location_geo;
    return !!item.address_not_found || !geo || geo.latitude == null || geo.longitude == null;
}

// Update the road warning / address-not-found badge on a card in-place
function updateCardBadge(docId, item) {
    const card = $(`[data-id="${docId}"]`);
    if (!card.length) return;
    card.find(".road-warning").remove();
    const warn = item.nearest_road && item.nearest_road.road_warning;
    let badge = "";
    if (warn) {
        badge = `<span class="road-warning ${warn.level}">${warn.text}</span>`;
    } else if (hasNoAddress(item)) {
        badge = `<span class="road-warning addr">no address</span>`;
    }
    if (badge) card.find(".my-card-img-wrap").prepend(badge);
}

function openMyDetail(item) {
    const overlay = document.getElementById("myDetailOverlay");
    if (!overlay) { console.error("myDetailOverlay not found in DOM"); return; }
    renderMyDetail(item);
    $("#myDetailOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeMyDetail() {
    if (myDetailBusy) return;
    $("#myDetailOverlay").removeClass("open");
    document.body.style.overflow = "";
    myDetailItem = null;
    myDetailOriginalValues = null;
}

function setMyDetailBusyState(isBusy, loadingText = "Saving your changes...") {
    myDetailBusy = isBusy;
    $("#myDetailBody").find("input, button").prop("disabled", isBusy);
    $("#myDetailClose").prop("disabled", isBusy);
    $("#myDetailLoadingText").text(loadingText);
    $("#myDetailLoadingState").prop("hidden", !isBusy);
    $("#cancelMyDetailRequestBtn").prop("hidden", true).prop("disabled", !isBusy);
}

function startMyDetailSlowActionTimer() {
    clearTimeout(myDetailSlowActionTimer);
    myDetailSlowActionTimer = window.setTimeout(() => {
        if (!myDetailBusy) return;
        $("#myDetailLoadingText").text("This is taking longer than expected. You can keep waiting or cancel.");
        $("#cancelMyDetailRequestBtn").prop("hidden", false).prop("disabled", false);
    }, SLOW_ACTION_DELAY_MS);
}

function stopMyDetailSlowActionTimer() {
    clearTimeout(myDetailSlowActionTimer);
    myDetailSlowActionTimer = null;
}

function cancelMyDetailAction() {
    myDetailCanceled = true;
    if (myDetailAbortController) myDetailAbortController.abort();
    stopMyDetailSlowActionTimer();
    setMyDetailBusyState(false);
    $("#myDetailError").text("Save canceled.").show();
}

function openEditModal(docId, currentTags) {
    // No longer used — editing is now inline in the detail modal
}

function closeEditModal() {}



// ── Page init ─────────────────────────────────────────────────────────────────

$(function () {

    // Escape key closes any open modal
    $(document).on("keydown", function (e) {
        if (e.key !== "Escape") return;
        closeDetail(); closeUploadModal(); closeEditModal(); closeMyDetail();
    });

    // ── Upload modal — runs on every authenticated page ───────────────────────
    if (document.getElementById("uploadOverlay")) {

        $("#navUploadBtn").on("click", openUploadModal);
        $("#uploadOverlay").on("click", function(e){if(e.target===this)closeUploadModal();});
        $("#uploadPanelClose").on("click", closeUploadModal);
        $("#uploadCancelRequestBtn").on("click", cancelUploadAction);

        $("input[name='location_mode']").on("change", function () {
            if (this.value === "auto") { $("#autoLocationSection").show(); $("#manualLocationSection").hide(); }
            else { $("#autoLocationSection").hide(); $("#manualLocationSection").show(); $("#geoStatus").text(""); }
        });

        $("#imageInput").on("change", async function () {
            const file = this.files[0]; if (!file) return;
            if ($("#locModeAuto").is(":checked")) {
                exifCoords = await extractExifGps(file);
                $("#geoStatus").text(exifCoords
                    ? `📍 GPS found in photo (${exifCoords.latitude}, ${exifCoords.longitude})`
                    : "No GPS data in photo — will try device location on upload.");
            }
        });

        $("#tagPillBox").on("click", ()=>$("#tagTextInput").focus());
        $("#tagTextInput").on("keydown", function(e){if(e.key==="Enter"){e.preventDefault();uploadPills.addFromInput();}})
                         .on("input", function(){if(this.value.includes(","))uploadPills.addFromInput();});

        $("#uploadForm").on("submit", async function (e) {
            e.preventDefault();
            const form = document.getElementById("uploadForm");
            uploadPills.addFromInput();
            if (uploadPills.getTags().length === 0) { $("#uploadError").text("Please add at least one tag.").show(); return; }
            $("#uploadError").hide();
            uploadCanceled = false;
            uploadAbortController = new AbortController();
            const formData = new FormData(form);
            formData.set("tags", $("#tagsHidden").val());
            setUploadBusyState(true, "Preparing your post...");
            startUploadSlowActionTimer();

            const mode = $("input[name='location_mode']:checked").val();
            if (mode === "manual") {
                const address = sanitizeInput($("#manual_address").val().trim());
                if (address) {
                    $("#geoStatus").show().text("Looking up address...");
                    const coords = await geocodeAddress(address, { signal: uploadAbortController.signal });
                    if (uploadCanceled) return;
                    if (coords) {
                        $("#latitude").val(coords.latitude);
                        $("#longitude").val(coords.longitude);
                        $("#geo_source").val("address");
                        $("#address_lookup_failed").val("");
                        formData.set("latitude", coords.latitude);
                        formData.set("longitude", coords.longitude);
                        formData.set("geo_source", "address");
                        formData.set("address_lookup_failed", "");
                        $("#geoStatus").text(`📍 Found: ${coords.latitude}, ${coords.longitude}`);
                    } else {
                        $("#latitude,#longitude,#geo_source").val("");
                        $("#address_lookup_failed").val("1");
                        formData.set("latitude", "");
                        formData.set("longitude", "");
                        formData.set("geo_source", "");
                        formData.set("address_lookup_failed", "1");
                        $("#geoStatus").show().text("Address not found - uploading without coordinates.");
                    }
                } else {
                    // Manual mode selected but address left blank
                    $("#latitude,#longitude,#geo_source").val("");
                    $("#address_lookup_failed").val("1");
                    formData.set("latitude", "");
                    formData.set("longitude", "");
                    formData.set("geo_source", "");
                    formData.set("address_lookup_failed", "1");
                    $("#geoStatus").show().text("No address entered - uploading without coordinates.");
                }
            } else {
                if (exifCoords) {
                    $("#latitude").val(exifCoords.latitude);
                    $("#longitude").val(exifCoords.longitude);
                    $("#geo_source").val("exif");
                    formData.set("latitude", exifCoords.latitude);
                    formData.set("longitude", exifCoords.longitude);
                    formData.set("geo_source", "exif");
                    formData.set("address_lookup_failed", "");
                }
                else {
                    $("#geoStatus").text("Requesting device location...");
                    const bc = await getBrowserLocation();
                    if (uploadCanceled) return;
                    if (bc) {
                        $("#latitude").val(bc.latitude);
                        $("#longitude").val(bc.longitude);
                        $("#geo_source").val("browser");
                        formData.set("latitude", bc.latitude);
                        formData.set("longitude", bc.longitude);
                        formData.set("geo_source", "browser");
                        formData.set("address_lookup_failed", "");
                        $("#geoStatus").text(`Using device location (${bc.latitude}, ${bc.longitude})`);
                    }
                    else {
                        formData.set("latitude", "");
                        formData.set("longitude", "");
                        formData.set("geo_source", "");
                        $("#geoStatus").text("Location unavailable - uploading without coordinates.");
                    }
                }
            }

            $("#location_label").val(sanitizeInput($("#location_label").val()));
            formData.set("location_label", $("#location_label").val());
            formData.set("manual_address", $("#manual_address").val());

            try {
                setUploadBusyState(true, "Uploading your post...");
                const res  = await fetch("/upload", {
                    method: "POST",
                    body: formData,
                    signal: uploadAbortController.signal,
                });
                const json = await res.json();
                if (uploadCanceled) return;
                if (res.ok && json.ok) {
                    setUploadBusyState(false);
                    closeUploadModal();
                    // Only refresh the feed if we're on the gallery page
                    if (document.getElementById("resultsGrid")) {
                        feedPage = 1; feedExhausted = false;
                        $("#resultsGrid").empty(); $("#searchStatus").text("");
                        activeTags = []; renderActiveTags();
                        await loadFeedPage();
                    }
                    if (document.getElementById("myUploadsGrid")) {
                        await loadMyUploads();
                    }
                } else { $("#uploadError").text(json.error || "Upload failed.").show(); }
            } catch (err) {
                if (err && err.name === "AbortError") {
                    if (!uploadCanceled) $("#uploadError").text("Upload canceled.").show();
                    return;
                }
                console.error(err);
                $("#uploadError").text("Network error - please try again.").show();
            } finally {
                stopUploadSlowActionTimer();
                uploadAbortController = null;
                if (!uploadCanceled) setUploadBusyState(false);
            }
        });
    }

    // ── Gallery page ──────────────────────────────────────────────────────────
    if (document.getElementById("resultsGrid")) {

        loadFeedPage();
        initInfiniteScroll();

        $("#tag_input").on("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); const v=$(this).val().trim(); if(v){addSearchTag(v);$(this).val("");} }
        }).on("input", function () { if(this.value.includes(",")){addSearchTag(this.value);$(this).val("");} });

        $("#searchForm").on("submit", function (e) {
            e.preventDefault();
            const v = $("#tag_input").val().trim();
            if (v) { addSearchTag(v); $("#tag_input").val(""); }
            else refreshGalleryResults();
        });

        $("#radiusSelect").on("change", function () {
            const value = this.value;
            if (!value) {
                clearNearbyFilter();
                return;
            }
            nearbyFilter.radiusKm = parseFloat(value);
            if (nearbyFilter.enabled) {
                $("#nearbyStatus").text(`Showing posts within ${nearbyFilter.radiusKm} km of your location.`);
                refreshGalleryResults();
                return;
            }
            enableNearbyFilter();
        });

        $("#clearNearbyBtn").on("click", function () {
            clearNearbyFilter();
        });

        $("#detailOverlay").on("click", function(e){if(e.target===this)closeDetail();});
        $("#detailClose").on("click", closeDetail);
        $("#reportAbuseBtn").on("click", async function () {
            const postId = $("#detailOverlay").data("postId");
            const reasonField = $("#detailAbuseReason");
            if (reasonField.prop("hidden")) {
                reasonField.prop("hidden", false).focus();
                $("#reportAbuseBtn").text("Send Abuse Report");
                $("#detailAbuseMessage").text("Please tell us why this post should be reviewed.");
                return;
            }
            const reason = sanitizeInput($("#detailAbuseReason").val());
            if (!postId) {
                $("#detailAbuseMessage").text("Post details are missing.");
                return;
            }
            if (!reason) {
                $("#detailAbuseMessage").text("Please explain why you are reporting this post.");
                return;
            }

            $("#detailAbuseMessage").text("Sending report...");
            $("#reportAbuseBtn").prop("disabled", true);
            try {
                const res = await fetch("/gallery/report-abuse", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ post_id: postId, reason }),
                });
                const json = await res.json();
                if (res.ok && json.ok) {
                    $("#detailAbuseReason").val("");
                    $("#detailAbuseReason").prop("hidden", true);
                    $("#reportAbuseBtn").text("Report Post");
                    $("#detailAbuseMessage").text("Report sent. Thank you.");
                } else {
                    $("#detailAbuseMessage").text(json.error || "Could not send the report.");
                }
            } catch (err) {
                console.error(err);
                $("#detailAbuseMessage").text("Network error. Please try again.");
            } finally {
                $("#reportAbuseBtn").prop("disabled", false);
            }
        });
    }

    // ── My Uploads page ───────────────────────────────────────────────────────
    if (document.getElementById("myUploadsGrid")) {

        loadMyUploads();

        // Delegated click — uses _myUploadsMap populated by loadMyUploads

        // ── Inline tag editing ────────────────────────────────────────────────
        $("#editTagPillBox").on("click", () => $("#editTagTextInput").focus());
        $("#editTagTextInput")
            .on("keydown", function(e){ if(e.key==="Enter"){e.preventDefault();editPills.addFromInput();} })
            .on("input",   function(){ if(this.value.includes(","))editPills.addFromInput(); });

        $("#editMyUploadBtn").on("click", function () {
            if (!myDetailItem) return;
            initializeMyDetailEditForm(myDetailItem);
            setMyDetailEditMode(true);
            $("#editTagTextInput").focus();
        });

        $("#cancelMyUploadEditBtn").on("click", function () {
            if (!myDetailItem) return;
            initializeMyDetailEditForm(myDetailItem);
            setMyDetailEditMode(false);
        });

        $("#cancelMyDetailRequestBtn").on("click", cancelMyDetailAction);

        $("#saveMyUploadBtn").on("click", async function () {
            editPills.addFromInput();
            const docId = myDetailItem && myDetailItem._id;
            const original = myDetailOriginalValues;
            if (!docId) return;
            const tags  = editPills.getTags();
            if (tags.length === 0) { $("#myDetailError").text("Please add at least one tag.").show(); return; }
            const address = sanitizeInput($("#editAddressInput").val().trim());
            const locLabel = sanitizeInput($("#editLocationInput").val().trim());
            const tagsChanged = !arraysEqual(tags, original ? original.tags : []);
            const addressChanged = address !== (original ? original.manual_address : "");
            const labelChanged = locLabel !== (original ? original.location_label : "");
            $("#myDetailError").hide();
            myDetailCanceled = false;
            myDetailAbortController = new AbortController();
            if (tagsChanged || addressChanged || labelChanged) {
                setMyDetailBusyState(true, "Saving your changes...");
                startMyDetailSlowActionTimer();
            }
            try {
                if (tagsChanged) {
                    const tagsRes  = await fetch(`/my-uploads/edit-tags/${docId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tags: tags.join(",") }),
                        signal: myDetailAbortController.signal
                    });
                    const tagsJson = await tagsRes.json();
                    if (myDetailCanceled) return;
                    if (!tagsRes.ok || !tagsJson.ok) {
                        $("#myDetailError").text(tagsJson.error || "Save failed.").show();
                        return;
                    }
                    myDetailItem.tags = tagsJson.tags;
                    window._myUploadsMap[docId].tags = tagsJson.tags;
                }

                if (addressChanged || labelChanged) {
                    let lat = original && original.location_geo ? original.location_geo.latitude : null;
                    let lon = original && original.location_geo ? original.location_geo.longitude : null;

                    if (addressChanged) {
                        if (address) {
                            $("#editAddressStatus").text("Looking up addressâ€¦");
                            const coords = await geocodeAddress(address, { signal: myDetailAbortController.signal });
                            if (myDetailCanceled) return;
                            if (coords) {
                                lat = coords.latitude;
                                lon = coords.longitude;
                                $("#editAddressStatus").text(`Found: ${lat}, ${lon}`);
                            } else {
                                lat = null;
                                lon = null;
                                $("#editAddressStatus").text("Address not found â€” saving without coordinates.");
                            }
                        } else {
                            lat = null;
                            lon = null;
                            $("#editAddressStatus").text("");
                        }
                    }

                    if (!myDetailBusy) {
                        setMyDetailBusyState(true, "Saving your changes...");
                    }

                    const locationRes  = await fetch(`/my-uploads/edit-location/${docId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ manual_address: address, location_label: locLabel, latitude: lat, longitude: lon }),
                        signal: myDetailAbortController.signal
                    });
                    const locationJson = await locationRes.json();
                    if (myDetailCanceled) return;
                    if (!locationRes.ok || !locationJson.ok) {
                        $("#myDetailError").text(locationJson.error || "Save failed.").show();
                        return;
                    }

                    myDetailItem.manual_address = locationJson.manual_address;
                    myDetailItem.location_label = locationJson.location_label;
                    myDetailItem.location_geo = locationJson.location_geo;
                    myDetailItem.nearest_road = locationJson.nearest_road;
                    myDetailItem.address_not_found = locationJson.address_not_found;
                    window._myUploadsMap[docId] = { ...window._myUploadsMap[docId], ...myDetailItem };
                    updateCardBadge(docId, myDetailItem);
                }

                const newPills = (myDetailItem.tags || []).slice(0, 3).map(t => `<span class="card-tag">${t}</span>`).join("");
                $(`[data-id="${docId}"]`).find(".card-tag-strip").html(newPills);
                setMyDetailBusyState(false);
                renderMyDetail(myDetailItem);
            } catch (err) {
                if (err && err.name === "AbortError") {
                    if (!myDetailCanceled) $("#myDetailError").text("Save canceled.").show();
                    return;
                }
                console.error(err);
                $("#myDetailError").text("Network error.").show();
            } finally {
                stopMyDetailSlowActionTimer();
                myDetailAbortController = null;
                if (!myDetailCanceled) setMyDetailBusyState(false);
            }
        });

        // ── Inline address editing ────────────────────────────────────────────

        $("#saveAddressBtn").on("click", async function () {
            const docId   = myDetailItem && myDetailItem._id;
            if (!docId) return;
            const address = sanitizeInput($("#editAddressInput").val().trim());
            const locLabel = sanitizeInput($("#editLocationInput").val().trim()) ||
                             (myDetailItem ? myDetailItem.location_label || "" : "");

            let lat = null, lon = null;
            if (address) {
                $("#editAddressStatus").text("Looking up address…");
                const coords = await geocodeAddress(address);
                if (coords) {
                    lat = coords.latitude;
                    lon = coords.longitude;
                    $("#editAddressStatus").text(`📍 Found: ${lat}, ${lon}`);
                } else {
                    $("#editAddressStatus").text("Address not found — saving without coordinates.");
                }
            }

            try {
                const res  = await fetch(`/my-uploads/edit-location/${docId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ manual_address: address, location_label: locLabel, latitude: lat, longitude: lon })
                });
                const json = await res.json();
                if (res.ok && json.ok) {
                    myDetailItem.manual_address    = json.manual_address;
                    myDetailItem.location_geo      = json.location_geo;
                    myDetailItem.nearest_road      = json.nearest_road;
                    myDetailItem.address_not_found = json.address_not_found;
                    window._myUploadsMap[docId]    = { ...window._myUploadsMap[docId], ...myDetailItem };
                    updateCardBadge(docId, myDetailItem);
                    renderMyDetail(myDetailItem);
                } else { $("#myDetailError").text(json.error || "Save failed.").show(); }
            } catch (err) { console.error(err); $("#myDetailError").text("Network error.").show(); }
        });

        // ── Inline location description editing ───────────────────────────────
        $("#editLocationBtn").on("click", function () {
            $("#editLocationInput").val(myDetailItem ? myDetailItem.location_label || "" : "");
            $("#editLocationSection").show();
            $("#editLocationInput").focus();
        });
        $("#cancelLocationBtn").on("click", () => $("#editLocationSection").hide());

        $("#saveLocationBtn").on("click", async function () {
            const docId    = myDetailItem && myDetailItem._id;
            if (!docId) return;
            const locLabel  = sanitizeInput($("#editLocationInput").val().trim());
            const address   = myDetailItem ? myDetailItem.manual_address || "" : "";
            const lat       = myDetailItem && myDetailItem.location_geo ? myDetailItem.location_geo.latitude : null;
            const lon       = myDetailItem && myDetailItem.location_geo ? myDetailItem.location_geo.longitude : null;
            try {
                const res  = await fetch(`/my-uploads/edit-location/${docId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ manual_address: address, location_label: locLabel, latitude: lat, longitude: lon })
                });
                const json = await res.json();
                if (res.ok && json.ok) {
                    myDetailItem.location_label = json.location_label;
                    window._myUploadsMap[docId].location_label = json.location_label;
                    renderMyDetail(myDetailItem);
                } else { $("#myDetailError").text(json.error || "Save failed.").show(); }
            } catch (err) { console.error(err); $("#myDetailError").text("Network error.").show(); }
        });

        // Detail modal close
        $("#myDetailOverlay").on("click", function(e){if(e.target===this)closeMyDetail();});
        $("#myDetailClose").on("click", closeMyDetail);

        $("#deleteUploadBtn").on("click", async function () {
            const docId = myDetailItem && myDetailItem._id;
            if (!docId || !window.confirm("Delete this upload permanently? This cannot be undone.")) return;
            try {
                const res  = await fetch(`/my-uploads/delete/${docId}`, { method: "DELETE" });
                const json = await res.json();
                if (res.ok && json.ok) {
                    $(`[data-id="${docId}"]`).remove();
                    delete window._myUploadsMap[docId];
                    closeMyDetail();
                    if ($("#myUploadsGrid").children().length === 0)
                        $("#myUploadsStatus").text("You haven't uploaded anything yet.");
                } else { $("#myDetailError").text(json.error || "Delete failed.").show(); }
            } catch (err) { console.error(err); $("#myDetailError").text("Network error.").show(); }
        });
    }
});
