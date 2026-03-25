import { describe, expect, it, afterEach, vi } from 'vitest';
import { createRoomId } from '../../src/api/roomApi.js';

describe('createRoomId', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns roomId on successful response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ roomId: 'ABC123' }),
        }));

        const result = await createRoomId('serenada.app');
        expect(result).toBe('ABC123');
    });

    it('calls the correct API URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ roomId: 'XYZ' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        await createRoomId('serenada.app');

        expect(mockFetch).toHaveBeenCalledWith(
            'https://serenada.app/api/room-id',
            { method: 'POST' },
        );
    });

    it('throws on non-ok HTTP response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
        }));

        await expect(createRoomId('serenada.app')).rejects.toThrow('Room ID request failed: 503');
    });

    it('throws when roomId is missing from response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        }));

        await expect(createRoomId('serenada.app')).rejects.toThrow('Room ID missing from response');
    });

    it('throws when response body is null', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => null,
        }));

        await expect(createRoomId('serenada.app')).rejects.toThrow('Room ID missing from response');
    });

    it('works with localhost serverHost', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ roomId: 'LOCAL_ROOM' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        const result = await createRoomId('localhost:8080');
        expect(result).toBe('LOCAL_ROOM');
        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:8080/api/room-id',
            { method: 'POST' },
        );
    });
});
