// Kiosk configuration. Edit this file only — app.js stays untouched.
window.KIOSK_CONFIG = {
  title: "ЛИЦЕЙ «СЕВЕР»",            // shown in the top-left logo (demo, fictional)
  subtitle: "расписание уроков",
  defaultCampusId: "north",
  campuses: [
    { id: "north", name: "Северный корпус", dataUrl: "data/north.json" },
    { id: "river", name: "Корпус на Набережной", dataUrl: "data/river.json" }
  ]
  // Alternatively load from your backend:
  // campusesUrl: "/api/timetable/campuses",
  // scheduleUrl: "/api/timetable/latest?campusId={campusId}"
};
