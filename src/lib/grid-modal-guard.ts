// Card #299: one predicate for "a modal sits over the schedule grid". Every grid
// keyboard and clipboard handler checks it, so a new modal is added in one place.
export type GridModals = { showVersions: boolean; showAlerts: boolean; showHelp: boolean; showExport: boolean };

export function gridModalOpen(m: GridModals): boolean {
  return m.showVersions || m.showAlerts || m.showHelp || m.showExport;
}
