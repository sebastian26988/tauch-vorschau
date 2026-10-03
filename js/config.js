// Verbindung zum Tauchlogbuch (Supabase-Projekt „Tauchlogbuch“).
// Der Publishable Key ist für den Browser bestimmt und steht ohnehin im ausgelieferten Logbuch-Frontend;
// der Zugriff auf Daten ist durch Login + Row Level Security (nur eigene Zeilen) geschützt.
export const SUPABASE_URL = 'https://dgwfvghajytqmxuplrhn.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ywsVEl3SoyC0d6JaVHFZbA_7W8eCmhg';

// Veröffentlichte Logbuch-App: liefert das OSM-Tauchplatzverzeichnis, das dort monatlich
// per GitHub Action erneuert wird – die Vorschau hat so immer denselben Stand wie das Logbuch.
export const LOGBOOK_URL = 'https://tauchlogbuch.pages.dev';
export const DIRECTORY_URL = `${LOGBOOK_URL}/osm/tauchplaetze.json`;
