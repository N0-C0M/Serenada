export const LOCAL_VIDEO_RESUME_GAP_MS = 15_000;
export const LOCAL_VIDEO_HEARTBEAT_INTERVAL_MS = 5_000;

interface ShouldForceLocalVideoRefreshArgs {
    hiddenDurationMs?: number | null;
    sleepGapMs?: number | null;
    thresholdMs?: number;
}

export function shouldForceLocalVideoRefresh({
    hiddenDurationMs,
    sleepGapMs,
    thresholdMs = LOCAL_VIDEO_RESUME_GAP_MS
}: ShouldForceLocalVideoRefreshArgs): boolean {
    return (hiddenDurationMs ?? 0) >= thresholdMs || (sleepGapMs ?? 0) >= thresholdMs;
}

interface ShouldRecoverLocalVideoArgs {
    hasVideoTrack: boolean;
    isScreenSharing: boolean;
    videoTrackReadyState: MediaStreamTrackState | null;
    videoTrackMuted: boolean;
    forceRefresh: boolean;
}

export function shouldRecoverLocalVideo({
    hasVideoTrack,
    isScreenSharing,
    videoTrackReadyState,
    videoTrackMuted,
    forceRefresh
}: ShouldRecoverLocalVideoArgs): boolean {
    if (!hasVideoTrack || isScreenSharing) {
        return false;
    }
    if (forceRefresh) {
        return true;
    }
    return videoTrackReadyState !== 'live' || videoTrackMuted;
}
