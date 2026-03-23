import type { CallErrorCode, CallState, CallStats, CameraMode, ConnectionStatus, MediaCapability, SerenadaConfig, SerenadaSessionHandle } from './types.js';
import { SignalingEngine } from './signaling/SignalingEngine.js';
import { MediaEngine } from './media/MediaEngine.js';
import { CallStatsCollector } from './media/callStats.js';
import type { TransportKind } from './signaling/transports/types.js';
import type { SignalingMessage } from './signaling/types.js';
import { resolveServerUrls } from './serverUrls.js';

function mapErrorCode(serverCode: string): CallErrorCode {
    switch (serverCode) {
        case 'JOIN_TIMEOUT':
            return 'signalingTimeout';
        case 'ROOM_FULL':
        case 'ROOM_CAPACITY_UNSUPPORTED':
            return 'roomFull';
        case 'ROOM_ENDED':
            return 'roomEnded';
        case 'CONNECTION_FAILED':
            return 'connectionFailed';
        case 'BAD_REQUEST':
        case 'UNSUPPORTED_VERSION':
        case 'INVALID_ROOM_ID':
        case 'SERVER_NOT_CONFIGURED':
        case 'INVALID_RECONNECT_TOKEN':
        case 'TURN_REFRESH_FAILED':
        case 'NOT_IN_ROOM':
        case 'NOT_HOST':
            return 'serverError';
        default:
            return 'unknown';
    }
}

/**
 * Represents an active call session. Created via {@link SerenadaCore.join} or
 * {@link SerenadaCore.createRoom}. Manages media, signaling, and call state.
 */
export class SerenadaSession implements SerenadaSessionHandle {
    private signaling: SignalingEngine;
    private media: MediaEngine;
    private statsCollector: CallStatsCollector;
    private _state: CallState;
    private stateListeners: ((state: CallState) => void)[] = [];
    private unsubSignalingMessages: (() => void) | null = null;
    private unsubSignalingState: (() => void) | null = null;
    private config: SerenadaConfig;
    private roomId: string;
    private roomUrl: string | null;
    private _destroyed = false;
    private permissionCheckDone = false;
    private permissionCheckInFlight = false;
    private endingTimer: number | null = null;

    onPermissionsRequired: ((permissions: MediaCapability[]) => void) | null = null;

    constructor(
        config: SerenadaConfig,
        roomId: string,
        roomUrl: string | null,
        deps?: { signaling?: SignalingEngine; media?: MediaEngine; statsCollector?: CallStatsCollector },
    ) {
        this.config = config;
        this.roomId = roomId;
        this.roomUrl = roomUrl;

        this._state = {
            phase: 'joining',
            roomId,
            roomUrl,
            localParticipant: null,
            remoteParticipants: [],
            connectionStatus: 'connected',
            activeTransport: null,
            requiredPermissions: null,
            error: null,
        };

        if (deps?.signaling) {
            this.signaling = deps.signaling;
        } else {
            const urls = resolveServerUrls(config.serverHost);
            this.signaling = new SignalingEngine({
                wsUrl: urls.wsUrl,
                httpBaseUrl: urls.httpBaseUrl,
                transports: config.transports,
                logger: config.logger,
            });
        }

        if (deps?.media) {
            this.media = deps.media;
        } else {
            this.media = new MediaEngine(
                { serverHost: config.serverHost, turnsOnly: config.turnsOnly, logger: config.logger },
                (type, payload, to) => this.signaling.sendMessage(type, payload, to),
            );
        }

        this.statsCollector = deps?.statsCollector ?? new CallStatsCollector(config.logger);

        // Wire signaling events to media engine
        this.unsubSignalingMessages = this.signaling.subscribeToMessages((msg) => {
            this.media.processSignalingMessage(msg);
        });

        this.unsubSignalingState = this.signaling.onStateChange(() => {
            this.media.updateSignalingConnected(this.signaling.isConnected);

            if (this.signaling.turnToken) {
                this.media.updateTurnToken(this.signaling.turnToken);
            }

            this.media.updateRoomState(this.signaling.roomState, this.signaling.clientId);
            this.rebuildState();
        });

        this.media.setOnChange(() => {
            this.rebuildState();
        });

        // Start connection + join (skip only when a fake signaling engine is injected)
        if (!deps?.signaling) {
            this.signaling.connect();
            this.signaling.joinRoom(roomId);
        }
    }

    /** Current call state. Subscribe via {@link subscribe} for updates. */
    get state(): CallState { return this._state; }
    /** Local media stream (camera/microphone), or `null` before media is acquired. */
    get localStream(): MediaStream | null { return this.media.localStream; }
    /** Map of remote participant CID to their media stream. */
    get remoteStreams(): Map<string, MediaStream> { return this.media.remoteStreams; }
    /** Current WebRTC call statistics, or `null` if not yet collecting. */
    get callStats(): CallStats | null { return this.statsCollector.stats; }
    get hasMultipleCameras(): boolean { return this.media.hasMultipleCameras; }
    get canScreenShare(): boolean { return this.media.canScreenShare; }
    get isSignalingConnected(): boolean { return this.signaling.isConnected; }
    get iceConnectionState(): RTCIceConnectionState { return this.media.iceConnectionState; }
    get peerConnectionState(): RTCPeerConnectionState { return this.media.connectionState; }
    get rtcSignalingState(): RTCSignalingState { return this.media.signalingState; }

    /** Subscribe to state changes. Returns an unsubscribe function. */
    subscribe(callback: (state: CallState) => void): () => void {
        this.stateListeners.push(callback);
        return () => {
            this.stateListeners = this.stateListeners.filter(l => l !== callback);
        };
    }

    subscribeToMessages(callback: (message: SignalingMessage) => void): () => void {
        return this.signaling.subscribeToMessages(callback);
    }

    /** Resume joining after media permissions have been granted. */
    async resumeJoin(): Promise<void> {
        this.permissionCheckDone = true;
        const stream = await this.media.startLocalMedia();
        if (stream) {
            this.rebuildState();
        }
    }

    /** Cancel an in-progress join and destroy the session. */
    cancelJoin(): void {
        this.permissionCheckDone = true;
        this._state = { ...this._state, phase: 'idle', requiredPermissions: null };
        this.notifyListeners();
        this.destroy();
    }

    /** Leave the call gracefully. The other participant stays connected. */
    leave(): void {
        if (this._destroyed) return;
        this.signaling.leaveRoom();
        this.media.cleanupAllPeers();
        this.statsCollector.stop();
        this._state = { ...this._state, phase: 'idle' };
        this.notifyListeners();
        this.destroy();
    }

    /** End the call for all participants. */
    end(): void {
        this.signaling.endRoom();
        this.leave();
    }

    /** Toggle local audio on/off. */
    toggleAudio(): void { this.setTrackEnabled('audio'); }
    /** Toggle local video on/off. */
    toggleVideo(): void { this.setTrackEnabled('video'); }

    /** Set local audio enabled state explicitly. */
    setAudioEnabled(enabled: boolean): void { this.setTrackEnabled('audio', enabled); }
    /** Set local video enabled state explicitly. */
    setVideoEnabled(enabled: boolean): void { this.setTrackEnabled('video', enabled); }

    /** Switch camera mode (selfie/world). Composite is not available on web. */
    setCameraMode(_mode: CameraMode): void {
        // Web only supports selfie/world via flipCamera; composite is not available
        if (_mode === 'world' && this.media.facingMode === 'user') {
            void this.flipCamera();
        } else if (_mode === 'selfie' && this.media.facingMode === 'environment') {
            void this.flipCamera();
        }
    }

    /** Cycle to the next camera mode (selfie to world or vice versa). */
    async flipCamera(): Promise<void> {
        await this.media.flipCamera();
    }

    /** Start sharing the screen, replacing the camera video track. */
    async startScreenShare(): Promise<void> {
        await this.media.startScreenShare();
    }

    /** Stop screen sharing and restore the camera video track. */
    async stopScreenShare(): Promise<void> {
        await this.media.stopScreenShare();
    }

    /** Clean up all resources. Call when done with the session. */
    destroy(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this.endingTimer !== null) { window.clearTimeout(this.endingTimer); this.endingTimer = null; }
        this.statsCollector.stop();
        this.unsubSignalingMessages?.();
        this.unsubSignalingState?.();
        this.media.destroy();
        this.signaling.destroy();
    }

    // --- Private ---

    private setTrackEnabled(kind: 'audio' | 'video', enabled?: boolean): void {
        const stream = this.media.localStream;
        if (!stream) return;
        const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
        if (track) track.enabled = enabled ?? !track.enabled;
        this.rebuildState();
    }

    private rebuildState(): void {
        if (this._destroyed) return;
        const signalingState = this.signaling.roomState;
        const clientId = this.signaling.clientId;

        let phase = this._state.phase;
        const error = this.signaling.error;

        if (error) {
            phase = 'error';
        } else if (!signalingState && phase !== 'idle' && phase !== 'ending') {
            if (this._state.phase === 'inCall' || this._state.phase === 'waiting') {
                // Room ended or left — show ending screen briefly
                phase = 'ending';
                if (this.endingTimer !== null) window.clearTimeout(this.endingTimer);
                this.endingTimer = window.setTimeout(() => {
                    this.endingTimer = null;
                    if (this._destroyed) return;
                    this._state = { ...this._state, phase: 'idle' };
                    this.notifyListeners();
                }, 3000);
            } else if (this.signaling.isConnected && this._state.phase === 'joining') {
                phase = 'joining';
            }
        } else if (signalingState) {
            const hasRemote = (signalingState.participants?.length ?? 0) > 1;
            if (hasRemote) {
                phase = 'inCall';
                this.ensureStatsCollection();
            } else {
                phase = 'waiting';
            }

            // Permission check: after joining, try to start media if not done
            if (!this.permissionCheckDone && !this.media.localStream) {
                this.checkPermissionsAndStartMedia();
            }
        }

        const audioTrack = this.media.localStream?.getAudioTracks()[0];
        const videoTrack = this.media.localStream?.getVideoTracks()[0];

        const localParticipant = clientId ? {
            cid: clientId,
            audioEnabled: audioTrack?.enabled ?? (this.config.defaultAudioEnabled !== false),
            videoEnabled: videoTrack?.enabled ?? (this.config.defaultVideoEnabled !== false),
            cameraMode: (this.media.isScreenSharing ? 'screenShare' : this.media.facingMode === 'user' ? 'selfie' : 'world') as CameraMode,
            isHost: signalingState?.hostCid === clientId,
        } : null;

        const remoteParticipants = (signalingState?.participants ?? [])
            .filter(p => p.cid !== clientId)
            .map(p => ({
                cid: p.cid,
                audioEnabled: true,
                videoEnabled: true,
                connectionState: this.media.connectionState,
            }));

        this._state = {
            phase,
            roomId: this.roomId,
            roomUrl: this.roomUrl,
            localParticipant,
            remoteParticipants,
            connectionStatus: this.media.connectionStatus as ConnectionStatus,
            activeTransport: this.signaling.activeTransport as TransportKind | null,
            requiredPermissions: this._state.requiredPermissions,
            error: error ? { code: mapErrorCode(error.code), message: error.message } : null,
        };

        this.notifyListeners();
    }

    private async checkPermissionsAndStartMedia(): Promise<void> {
        if (this.permissionCheckDone || this.permissionCheckInFlight) return;
        this.permissionCheckInFlight = true;

        // Try to detect permission status without prompting
        const permissionsNeeded: MediaCapability[] = [];
        try {
            if (navigator.permissions) {
                const [cameraResult, micResult] = await Promise.all([
                    navigator.permissions.query({ name: 'camera' as PermissionName }).catch(() => null),
                    navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null),
                ]);
                if (cameraResult?.state === 'denied') permissionsNeeded.push('camera');
                if (micResult?.state === 'denied') permissionsNeeded.push('microphone');

                if (cameraResult?.state === 'prompt' || micResult?.state === 'prompt') {
                    // Permissions need prompting - signal to host/call-ui
                    const required: MediaCapability[] = [];
                    if (cameraResult?.state === 'prompt') required.push('camera');
                    if (micResult?.state === 'prompt') required.push('microphone');
                    this.permissionCheckInFlight = false;
                    this._state = { ...this._state, phase: 'awaitingPermissions', requiredPermissions: required };
                    this.notifyListeners();
                    this.onPermissionsRequired?.(required);
                    return;
                }
            }
        } catch {
            // Permissions API not available — signal host/call-ui to handle permissions
            this.permissionCheckInFlight = false;
            const required: MediaCapability[] = ['camera', 'microphone'];
            this._state = { ...this._state, phase: 'awaitingPermissions', requiredPermissions: required };
            this.notifyListeners();
            this.onPermissionsRequired?.(required);
            return;
        }

        if (permissionsNeeded.length > 0) {
            this.permissionCheckInFlight = false;
            this._state = { ...this._state, phase: 'awaitingPermissions', requiredPermissions: permissionsNeeded };
            this.notifyListeners();
            this.onPermissionsRequired?.(permissionsNeeded);
            return;
        }

        // Permissions are granted — start media
        this.permissionCheckDone = true;
        this.permissionCheckInFlight = false;
        await this.media.startLocalMedia();
        this.rebuildState();
    }

    private ensureStatsCollection(): void {
        if (this.statsCollector.stats !== null) return;
        this.statsCollector.start(
            () => this.media.getPeerConnections(),
            () => this.notifyListeners(),
        );
    }

    private notifyListeners(): void {
        const state = this._state;
        [...this.stateListeners].forEach(cb => cb(state));
    }
}
