import math
import requests
from typing import Optional
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS


# ── OSM highway classification ────────────────────────────────────────────────

HIGHWAY_LABELS = {
    "motorway":       "motorway",
    "trunk":          "major road",
    "primary":        "primary road",
    "secondary":      "secondary road",
    "tertiary":       "minor road",
    "unclassified":   "unclassified road",
    "residential":    "residential road",
    "service":        "service road",
    "living_street":  "living street",
    "pedestrian":     "pedestrian street",
    "track":          "unpaved track",
    "path":           "path",
    "footway":        "footpath",
    "bridleway":      "bridleway",
    "cycleway":       "cycleway",
    "steps":          "steps",
    "motorway_link":  "motorway slip road",
    "trunk_link":     "major road slip road",
    "primary_link":   "primary road slip road",
    "secondary_link": "secondary road slip road",
    "tertiary_link":  "minor road slip road",
}

MAJOR_ROAD_TYPES = {
    "motorway", "trunk", "primary", "secondary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link",
}

MINOR_ROAD_TYPES = {
    "tertiary", "residential", "unclassified",
    "living_street", "pedestrian", "tertiary_link",
}

EXCLUDED_TYPES = {
    "service", "footway", "path", "track",
    "bridleway", "cycleway", "steps",
}

HEADERS = {"User-Agent": "ForagersAssistant/1.0", "Accept-Language": "en"}


# ── Geometry ──────────────────────────────────────────────────────────────────

def haversine_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two lat/lon points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── EXIF GPS extraction ───────────────────────────────────────────────────────

def _dms_to_decimal(dms_values, ref: str) -> float:
    def to_float(v):
        try:
            return float(v)
        except TypeError:
            return v[0] / v[1]
    deg = to_float(dms_values[0])
    mn  = to_float(dms_values[1])
    sec = to_float(dms_values[2])
    decimal = deg + mn / 60 + sec / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return round(decimal, 7)


def extract_exif_gps(filepath: str) -> Optional[dict]:
    """Extract GPS coordinates from a JPEG's EXIF data using Pillow."""
    try:
        img = Image.open(filepath)
        exif_data = img._getexif()
        if exif_data is None:
            return None
        gps_info = None
        for tag_id, val in exif_data.items():
            if TAGS.get(tag_id, tag_id) == "GPSInfo":
                gps_info = val
                break
        if not gps_info:
            return None
        gps = {GPSTAGS.get(k, k): v for k, v in gps_info.items()}
        if "GPSLatitude" not in gps or "GPSLongitude" not in gps:
            return None
        lat = _dms_to_decimal(gps["GPSLatitude"],  gps.get("GPSLatitudeRef",  "N"))
        lon = _dms_to_decimal(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
        return {"latitude": lat, "longitude": lon, "source": "exif"}
    except Exception:
        return None


# ── Road warning logic ────────────────────────────────────────────────────────

def compute_road_warning(highway_type: str, distance_metres: float) -> Optional[dict]:
    """
    Return {"level": "yellow"|"red"|"black", "text": str} or None.

    Major roads:  < 60 m yellow,  < 30 m red,  < 15 m black
    Minor roads:  < 30 m yellow,  < 15 m red,  <  5 m black
    """
    if distance_metres is None:
        return None
    if highway_type in MAJOR_ROAD_TYPES:
        if distance_metres < 15:
            return {"level": "black",  "text": "near major road"}
        if distance_metres < 30:
            return {"level": "red",    "text": "near major road"}
        if distance_metres < 60:
            return {"level": "yellow", "text": "near major road"}
    elif highway_type in MINOR_ROAD_TYPES:
        if distance_metres < 5:
            return {"level": "black",  "text": "near minor road"}
        if distance_metres < 15:
            return {"level": "red",    "text": "near minor road"}
        if distance_metres < 30:
            return {"level": "yellow", "text": "near minor road"}
    return None


# ── Nominatim reverse geocoding ───────────────────────────────────────────────

def nearest_road_nominatim(lat: float, lon: float) -> Optional[dict]:
    """Fast road name lookup via Nominatim reverse geocoding."""
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json"},
            headers=HEADERS,
            timeout=5,
        )
        addr = resp.json().get("address", {})
        road_name = addr.get("road")
        return {"name": road_name} if road_name else None
    except Exception as e:
        print(f"Nominatim error: {e}")
        return None


# ── Overpass road lookup ──────────────────────────────────────────────────────

def nearest_road_overpass(lat: float, lon: float, radius: int = 100) -> Optional[dict]:
    """
    Query Overpass for roads within radius metres, excluding non-road types.
    Returns the road with the highest danger score (black > red > yellow > none).
    Falls back to 500 m if nothing found in the initial radius.
    """
    WARNING_SCORE = {"black": 3, "red": 2, "yellow": 1, None: 0}

    def run_query(search_radius: int) -> Optional[dict]:
        query = f"""
        [out:json][timeout:10];
        way(around:{search_radius},{lat},{lon})[highway];
        out body; >; out skel qt;
        """
        try:
            resp = requests.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
                headers=HEADERS,
                timeout=15,
            )
            elements = resp.json().get("elements", [])
        except Exception as e:
            print(f"Overpass error: {e}")
            return None

        nodes = {
            el["id"]: (el["lat"], el["lon"])
            for el in elements if el["type"] == "node"
        }

        best       = None
        best_score = -1
        best_dist  = float("inf")

        for el in elements:
            if el["type"] != "way":
                continue
            highway_type = el.get("tags", {}).get("highway", "")
            if not highway_type or highway_type in EXCLUDED_TYPES:
                continue

            road_name = (
                el.get("tags", {}).get("name")
                or el.get("tags", {}).get("ref")
                or HIGHWAY_LABELS.get(highway_type, highway_type)
            )

            way_dist = float("inf")
            for node_id in el.get("nodes", []):
                if node_id not in nodes:
                    continue
                d = haversine_metres(lat, lon, *nodes[node_id])
                if d < way_dist:
                    way_dist = d

            if way_dist == float("inf"):
                continue

            warning = compute_road_warning(highway_type, way_dist)
            score   = WARNING_SCORE.get(warning["level"] if warning else None, 0)

            if score > best_score or (score == best_score and way_dist < best_dist):
                best_score = score
                best_dist  = way_dist
                best = {
                    "name":            road_name,
                    "type":            highway_type,
                    "type_label":      HIGHWAY_LABELS.get(highway_type, highway_type),
                    "distance_metres": round(way_dist, 1),
                }

        return best

    result = run_query(radius)
    if result is None:
        result = run_query(500)
    return result


# ── Combined lookup ───────────────────────────────────────────────────────────

def lookup_nearest_road(lat: float, lon: float) -> Optional[dict]:
    """
    Combine Overpass (precise distance + type) with Nominatim (road name fallback).
    Attaches road_warning before returning.
    """
    overpass  = nearest_road_overpass(lat, lon)
    nominatim = nearest_road_nominatim(lat, lon)

    if overpass:
        if nominatim and nominatim.get("name"):
            if overpass["name"] == overpass.get("type_label", ""):
                overpass["name"] = nominatim["name"]
        overpass["road_warning"] = compute_road_warning(
            overpass["type"], overpass["distance_metres"]
        )
        return overpass

    if nominatim:
        nominatim.update({
            "type":            "unknown",
            "type_label":      "road",
            "distance_metres": None,
            "road_warning":    None,
        })
        return nominatim

    return None
