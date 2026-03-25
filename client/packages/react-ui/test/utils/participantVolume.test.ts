import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PARTICIPANT_VOLUME,
    normalizeParticipantVolume,
    parseParticipantVolumeInput,
    participantVolumeToPercent,
} from '../../src/utils/participantVolume';

describe('participantVolume', () => {
    it('defaults to 1 for non-finite values', () => {
        expect(normalizeParticipantVolume(Number.NaN)).toBe(DEFAULT_PARTICIPANT_VOLUME);
        expect(normalizeParticipantVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PARTICIPANT_VOLUME);
    });

    it('clamps values to [0, 1]', () => {
        expect(normalizeParticipantVolume(-0.5)).toBe(0);
        expect(normalizeParticipantVolume(1.5)).toBe(1);
        expect(normalizeParticipantVolume(0.42)).toBe(0.42);
    });

    it('parses slider percentage values', () => {
        expect(parseParticipantVolumeInput('0')).toBe(0);
        expect(parseParticipantVolumeInput('50')).toBe(0.5);
        expect(parseParticipantVolumeInput('100')).toBe(1);
        expect(parseParticipantVolumeInput('300')).toBe(1);
    });

    it('converts volume to rounded percentage', () => {
        expect(participantVolumeToPercent(0)).toBe(0);
        expect(participantVolumeToPercent(0.555)).toBe(56);
        expect(participantVolumeToPercent(1)).toBe(100);
        expect(participantVolumeToPercent(-1)).toBe(0);
    });
});
