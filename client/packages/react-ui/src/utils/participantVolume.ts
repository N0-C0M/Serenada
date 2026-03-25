export const DEFAULT_PARTICIPANT_VOLUME = 1;

const MIN_PARTICIPANT_VOLUME = 0;
const MAX_PARTICIPANT_VOLUME = 1;
const PARTICIPANT_VOLUME_PERCENT_DIVISOR = 100;

export function normalizeParticipantVolume(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_PARTICIPANT_VOLUME;
    if (value < MIN_PARTICIPANT_VOLUME) return MIN_PARTICIPANT_VOLUME;
    if (value > MAX_PARTICIPANT_VOLUME) return MAX_PARTICIPANT_VOLUME;
    return value;
}

export function parseParticipantVolumeInput(rawValue: string): number {
    return normalizeParticipantVolume(Number(rawValue) / PARTICIPANT_VOLUME_PERCENT_DIVISOR);
}

export function participantVolumeToPercent(volume: number): number {
    return Math.round(normalizeParticipantVolume(volume) * PARTICIPANT_VOLUME_PERCENT_DIVISOR);
}
