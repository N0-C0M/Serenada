export type RemoteVideoFit = 'cover' | 'contain';

const STORAGE_KEY = 'serenada_remote_video_fit';

const isRemoteVideoFit = (value: unknown): value is RemoteVideoFit =>
    value === 'cover' || value === 'contain';

export const getPersistedRemoteVideoFit = (defaultValue: RemoteVideoFit = 'cover'): RemoteVideoFit => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return isRemoteVideoFit(stored) ? stored : defaultValue;
    } catch (error) {
        console.error('Failed to read remote video fit preference', error);
        return defaultValue;
    }
};

export const persistRemoteVideoFit = (value: RemoteVideoFit) => {
    try {
        localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
        console.error('Failed to persist remote video fit preference', error);
    }
};
