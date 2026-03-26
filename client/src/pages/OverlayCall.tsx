import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Link2,
    Maximize2,
    Mic,
    MicOff,
    Minimize2,
    Phone,
    PhoneOff,
    ScreenShare,
    ScreenShareOff,
    Video,
    VideoOff,
} from 'lucide-react';
import { SerenadaCore } from '@serenada/core';
import type { CallState, MediaCapability, SerenadaSessionHandle } from '@serenada/core';
import { SerenadaPermissions } from '@serenada/react-ui';
import { getConfiguredServerHost } from '../utils/serverHost';

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/;

const OVERLAY_IDLE_STATE: CallState = {
    phase: 'idle',
    roomId: null,
    roomUrl: null,
    localParticipant: null,
    remoteParticipants: [],
    connectionStatus: 'connected',
    activeTransport: null,
    requiredPermissions: null,
    error: null,
};

function readRoomIdFromPath(pathname: string): string | null {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    const callIndex = parts.indexOf('call');
    if (callIndex !== -1) {
        const candidate = parts[callIndex + 1];
        return candidate && ROOM_ID_PATTERN.test(candidate) ? candidate : null;
    }

    const fallback = parts[parts.length - 1];
    return fallback && ROOM_ID_PATTERN.test(fallback) ? fallback : null;
}

function resolveRoomId(rawInput: string): string | null {
    const value = rawInput.trim();
    if (!value) return null;
    if (ROOM_ID_PATTERN.test(value)) return value;

    const candidates = [value];

    if (value.startsWith('/')) {
        candidates.push(`${window.location.origin}${value}`);
    }

    if (!/^https?:\/\//i.test(value) && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value)) {
        candidates.push(`https://${value}`);
    }

    for (const candidate of candidates) {
        try {
            const parsed = new URL(candidate);
            const roomId = readRoomIdFromPath(parsed.pathname);
            if (roomId) return roomId;
        } catch {
            // Ignore malformed URL candidates.
        }
    }

    return null;
}

function getPhaseLabel(state: CallState): string {
    switch (state.phase) {
        case 'joining':
            return 'Connecting';
        case 'awaitingPermissions':
            return 'Waiting permissions';
        case 'waiting':
            return 'Waiting for others';
        case 'inCall':
            return 'In call';
        case 'ending':
            return 'Call ended';
        case 'error':
            return 'Connection error';
        default:
            return 'Idle';
    }
}

const OverlayCall: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();

    const core = useMemo(
        () => new SerenadaCore({ serverHost: getConfiguredServerHost() }),
        [],
    );

    const [callInput, setCallInput] = useState('');
    const [session, setSession] = useState<SerenadaSessionHandle | null>(null);
    const [callState, setCallState] = useState<CallState>(OVERLAY_IDLE_STATE);
    const [overlayError, setOverlayError] = useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const initialLink = params.get('link') ?? params.get('url') ?? params.get('call');
        if (!initialLink) return;
        setCallInput(initialLink);
    }, []);

    useEffect(() => {
        if (!session) {
            setCallState(OVERLAY_IDLE_STATE);
            return;
        }

        setCallState(session.state);
        return session.subscribe((nextState) => {
            setCallState(nextState);
        });
    }, [session]);

    useEffect(() => {
        if (!session) return;

        let active = true;

        session.onPermissionsRequired = (permissions: MediaCapability[]) => {
            void (async () => {
                const granted = await SerenadaPermissions.request(permissions);
                if (!active) return;
                if (!granted) {
                    setOverlayError('Allow camera and microphone access to continue.');
                    return;
                }

                setOverlayError(null);

                try {
                    await session.resumeJoin();
                } catch (err) {
                    console.error('[OverlayCall] Failed to resume join', err);
                    if (!active) return;
                    setOverlayError('Could not resume call after permission grant.');
                }
            })();
        };

        return () => {
            active = false;
            session.onPermissionsRequired = null;
        };
    }, [session]);

    useEffect(() => {
        if (!callState.error) return;
        setOverlayError(callState.error.message);
    }, [callState.error]);

    useEffect(() => {
        if (!session) return;
        if (callState.phase !== 'idle') return;
        session.destroy();
        setSession(null);
        setIsCollapsed(false);
    }, [callState.phase, session]);

    useEffect(() => () => {
        session?.destroy();
    }, [session]);

    const handleJoin = useCallback(() => {
        if (session) return;

        const roomId = resolveRoomId(callInput);
        if (!roomId) {
            setOverlayError('Paste a valid call link or room ID.');
            return;
        }

        const nextSession = core.join({ roomId });
        setSession(nextSession);
        setOverlayError(null);
        setIsCollapsed(false);
    }, [callInput, core, session]);

    const handleLeave = useCallback(() => {
        if (!session) return;
        session.leave();
        setSession(null);
        setOverlayError(null);
        setIsCollapsed(false);
    }, [session]);

    const handleReset = useCallback(() => {
        session?.destroy();
        setSession(null);
        setOverlayError(null);
        setIsCollapsed(false);
    }, [session]);

    const handlePaste = useCallback(() => {
        if (!navigator.clipboard?.readText) return;
        void navigator.clipboard.readText()
            .then((value) => {
                if (!value) return;
                setCallInput(value.trim());
            })
            .catch(() => {});
    }, []);

    const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        handleJoin();
    }, [handleJoin]);

    const handleToggleAudio = useCallback(() => {
        session?.toggleAudio();
    }, [session]);

    const handleToggleVideo = useCallback(() => {
        session?.toggleVideo();
    }, [session]);

    const isScreenSharing = callState.localParticipant?.cameraMode === 'screenShare';

    const handleToggleScreenShare = useCallback(() => {
        if (!session) return;
        if (isScreenSharing) {
            void session.stopScreenShare();
            return;
        }
        void session.startScreenShare();
    }, [isScreenSharing, session]);

    const phaseLabel = useMemo(() => getPhaseLabel(callState), [callState]);
    const participantCount = (callState.localParticipant ? 1 : 0) + callState.remoteParticipants.length;
    const isMuted = callState.localParticipant?.audioEnabled === false;
    const isVideoOff = callState.localParticipant?.videoEnabled === false;
    const canScreenShare = session?.canScreenShare === true;

    const statusClass = useMemo(() => {
        if (callState.phase === 'inCall') return 'overlay-state-live';
        if (callState.phase === 'waiting') return 'overlay-state-waiting';
        if (callState.phase === 'error') return 'overlay-state-error';
        return 'overlay-state-connecting';
    }, [callState.phase]);

    if (!session) {
        return (
            <div className="overlay-page">
                <div className="overlay-window overlay-window-join">
                    <div className="overlay-title-row">
                        <div>
                            <h2 className="overlay-title">Game Voice Overlay</h2>
                            <p className="overlay-subtitle">Paste a call link and join in one click</p>
                        </div>
                        <button type="button" className="overlay-chip-btn" onClick={() => navigate('/')}>
                            {t('home')}
                        </button>
                    </div>

                    <label htmlFor="overlay-call-link" className="overlay-input-label">
                        Call link
                    </label>
                    <div className="overlay-input-row">
                        <input
                            id="overlay-call-link"
                            type="text"
                            value={callInput}
                            onChange={(event) => setCallInput(event.target.value)}
                            onKeyDown={handleInputKeyDown}
                            placeholder="https://serenada.app/call/roomId"
                            className="overlay-input"
                        />
                        <button type="button" className="overlay-chip-btn" onClick={handlePaste}>
                            Paste
                        </button>
                    </div>

                    <button
                        type="button"
                        className="overlay-join-btn"
                        disabled={!callInput.trim()}
                        onClick={handleJoin}
                    >
                        <Link2 size={16} />
                        {t('join_call')}
                    </button>

                    {overlayError && <p className="overlay-error">{overlayError}</p>}
                </div>
            </div>
        );
    }

    if (isCollapsed) {
        return (
            <div className="overlay-page">
                <button
                    type="button"
                    className={`overlay-bubble ${statusClass}`}
                    onClick={() => setIsCollapsed(false)}
                    title="Expand voice controls"
                    aria-label="Expand voice controls"
                >
                    <Phone size={24} />
                    <span className="overlay-bubble-pulse" aria-hidden="true" />
                </button>
            </div>
        );
    }

    return (
        <div className="overlay-page">
            <div className={`overlay-window overlay-window-controls ${statusClass}`}>
                <div className="overlay-title-row">
                    <div className="overlay-status">
                        <span className="overlay-status-dot" />
                        <span>{phaseLabel}</span>
                    </div>
                    <div className="overlay-meta">{participantCount} online</div>
                    <button
                        type="button"
                        className="overlay-icon-btn"
                        onClick={() => setIsCollapsed(true)}
                        title="Collapse"
                        aria-label="Collapse"
                    >
                        <Minimize2 size={16} />
                    </button>
                </div>

                <div className="overlay-controls-row">
                    <button
                        type="button"
                        className={`overlay-control-btn ${isMuted ? 'active' : ''}`}
                        onClick={handleToggleAudio}
                        title={isMuted ? 'Unmute' : 'Mute'}
                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                        {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>

                    <button
                        type="button"
                        className={`overlay-control-btn ${isVideoOff ? 'active' : ''}`}
                        onClick={handleToggleVideo}
                        title={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
                        aria-label={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
                    >
                        {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
                    </button>

                    {canScreenShare && (
                        <button
                            type="button"
                            className={`overlay-control-btn ${isScreenSharing ? 'active' : ''}`}
                            onClick={handleToggleScreenShare}
                            title={isScreenSharing ? 'Stop screen share' : 'Share screen'}
                            aria-label={isScreenSharing ? 'Stop screen share' : 'Share screen'}
                        >
                            {isScreenSharing ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
                        </button>
                    )}

                    <button
                        type="button"
                        className="overlay-control-btn danger"
                        onClick={handleLeave}
                        title="Leave call"
                        aria-label="Leave call"
                    >
                        <PhoneOff size={20} />
                    </button>
                </div>

                {callState.roomId && (
                    <div className="overlay-room-label">Room: {callState.roomId}</div>
                )}

                {overlayError && <p className="overlay-error">{overlayError}</p>}

                {callState.phase === 'error' && (
                    <button type="button" className="overlay-reset-btn" onClick={handleReset}>
                        <Maximize2 size={14} />
                        Reset
                    </button>
                )}
            </div>
        </div>
    );
};

export default OverlayCall;
