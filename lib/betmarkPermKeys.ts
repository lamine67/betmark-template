export const BETMARK_PERM_KEYS = [
  "board_view", "status_view", "live_view", "match_view", "proxies_view",
  "sync_view_config", "sync_edit_config", "sync_force_now", "sync_view_logs",
  "calibration_view", "calibration_view_diagnosis", "calibration_submit_url",
  "calibration_submit_photo_auto", "calibration_submit_photo_flag", "calibration_delete",
  "reports_download_final", "reports_download_live_snapshot",
  "live_tracking_start", "live_tracking_join_already_live", "live_tracking_edit",
  "live_tracking_stop", "live_tracking_remove", "live_tracking_choose_bookmakers",
  "live_tracking_choose_detail_level", "live_tracking_choose_ultra",
  "auto_track_view", "auto_track_edit",
  "proxies_rename", "proxies_delete",
  "match_delete_all",
  "forks_view",
] as const;

export type BetmarkPermKey = (typeof BETMARK_PERM_KEYS)[number];
export type BetmarkPerms = Record<BetmarkPermKey, boolean>;
