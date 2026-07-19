// Theme vor dem ersten Rendern setzen (gespeicherte Wahl oder Systemeinstellung).
// Eigene Datei statt Inline-Skript, damit die Content-Security-Policy
// Inline-Skripte komplett verbieten kann.
document.documentElement.dataset.theme = localStorage.getItem("vb-theme") ||
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
