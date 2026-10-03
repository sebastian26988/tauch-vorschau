// Leaflet-Karte im Spot-Editor (global `L` aus dem CDN-Skript)
import { fmt } from './units.js';

export function createPicker(el, { lat, lon }, onPick, { readOnly = false } = {}) {
  if (typeof L === 'undefined') {
    el.innerHTML = '<p class="muted">Karte nicht verfügbar – Koordinaten bitte manuell eingeben.</p>';
    return null;
  }
  const map = L.map(el, { scrollWheelZoom: true }).setView([lat, lon], 10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const marker = L.marker([lat, lon], { draggable: !readOnly }).addTo(map);
  const nearby = L.layerGroup().addTo(map);
  const stations = L.layerGroup().addTo(map);

  const pick = (ll) => {
    marker.setLatLng(ll);
    onPick(ll.lat, ll.lng);
  };
  if (!readOnly) {
    map.on('click', (e) => pick(e.latlng));
    marker.on('dragend', () => pick(marker.getLatLng()));
  }

  return {
    setPosition(newLat, newLon, zoom) {
      marker.setLatLng([newLat, newLon]);
      if (zoom) map.setView([newLat, newLon], zoom);
      else map.panTo([newLat, newLon]);
    },
    // Bekannte Tauchplätze aus dem Verzeichnis als graue Punkte
    showNearby(list, onSelect) {
      nearby.clearLayers();
      for (const s of list) {
        L.circleMarker([s.lat, s.lon], { radius: 5, weight: 1, color: '#6b7a85', fillColor: '#9aa8b2', fillOpacity: 0.8 })
          .bindTooltip(`${s.label}${s.detail ? `<br>${s.detail}` : ''}`)
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (!readOnly) onSelect(s);
          })
          .addTo(nearby);
      }
    },
    showStations(list, onSelect) {
      stations.clearLayers();
      for (const s of list) {
        L.circleMarker([s.lat, s.lon], { radius: 6, weight: 2, color: '#0b6e99', fillOpacity: s.stale ? 0.1 : 0.6 })
          .bindTooltip(`${s.name}<br>${s.stale ? 'keine aktuellen Daten' : `${fmt(s.value, 1)} °C`}`)
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            onSelect(s);
          })
          .addTo(stations);
      }
    },
    refresh() {
      map.invalidateSize();
    },
    destroy() {
      map.remove();
    },
  };
}
