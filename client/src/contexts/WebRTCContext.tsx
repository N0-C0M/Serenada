import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useSignaling } from './SignalingContext';
import { useToast } from './ToastContext';
import { useTranslation } from 'react-i18next';
import {
    OFFER_TIMEOUT_MS,
    ICE_CANDIDATE_BUFFER_MAX,
    TURN_FETCH_TIMEOUT_MS,
} from '../constants/webrtcResilience';

// Default STUN config for non-blocking ICE bootstrap
const DEFAULT_RTC_CONFIG: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export type ConnectionStatus = 'connected' | 'recovering' | 'retrying';

interface WebRTCContextValue {
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    remoteStreams: Record<string, MediaStream>;
    startLocalMedia: () => Promise<MediaStream | null>;
    stopLocalMedia: () => void;
    startScreenShare: () => Promise<void>;
    stopScreenShare: () => Promise<void>;
    isScreenSharing: boolean;
    canScreenShare: boolean;
    flipCamera: () => Promise<void>;
    facingMode: 'user' | 'environment';
    hasMultipleCameras: boolean;
    peerConnection: RTCPeerConnection | null;
    iceConnectionState: RTCIceConnectionState;
    connectionState: RTCPeerConnectionState;
    signalingState: RTCSignalingState;
    connectionStatus: ConnectionStatus;
}

const WebRTCContext = createContext<WebRTCContextValue | null>(null);

export const useWebRTC = () => {
    const context = useContext(WebRTCContext);
    if (!context) {
        throw new Error('useWebRTC must be used within a WebRTCProvider');
    }
    return context;
};

export const WebRTCProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { sendMessage, roomState, clientId, isConnected, subscribeToMessages, turnToken } = useSignaling();
    const { showToast } = useToast();
    const { t } = useTranslation();

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [canScreenShare, setCanScreenShare] = useState(false);
    const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>('new');
    const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
    const [signalingState, setSignalingState] = useState<RTCSignalingState>('stable');
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connected');

    // RTC config state: initialize with STUN immediately, then swap to TURN when token is available.
    const [rtcConfig, setRtcConfig] = useState<RTCConfiguration>(DEFAULT_RTC_CONFIG);

    const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const remoteStreamsByPeerRef = useRef<Map<string, MediaStream>>(new Map());
    const pendingIceByPeerRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
    const offerTimeoutsRef = useRef<Map<string, number>>(new Map());
    const makingOfferPeersRef = useRef<Set<string>>(new Set());

    const screenShareTrackRef = useRef<MediaStreamTrack | null>(null);
    const requestingMediaRef = useRef(false);
    const unmountedRef = useRef(false);
    const mediaRequestIdRef = useRef(0);

    const localStreamRef = useRef<MediaStream | null>(null);
    const roomStateRef = useRef(roomState);
    const clientIdRef = useRef(clientId);
    const isConnectedRef = useRef(isConnected);
    const sendMessageRef = useRef(sendMessage);

    const facingModeRef = useRef<'user' | 'environment'>('user');
    const isScreenSharingRef = useRef(false);
    const rtcConfigRef = useRef<RTCConfiguration>(DEFAULT_RTC_CONFIG);

    const connectionStatusRef = useRef<ConnectionStatus>('connected');
    const retryingTimerRef = useRef<number | null>(null);

    const createOfferForPeerRef = useRef<(peerCid: string, options?: RTCOfferOptions) => Promise<void>>(async () => {
        // Assigned by effect after declaration.
    });

    useEffect(() => {
        sendMessageRef.current = sendMessage;
    }, [sendMessage]);

    useEffect(() => {
        roomStateRef.current = roomState;
    }, [roomState]);

    useEffect(() => {
        clientIdRef.current = clientId;
    }, [clientId]);

    useEffect(() => {
        isConnectedRef.current = isConnected;
    }, [isConnected]);

    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    useEffect(() => {
        facingModeRef.current = facingMode;
    }, [facingMode]);

    useEffect(() => {
        isScreenSharingRef.current = isScreenSharing;
    }, [isScreenSharing]);

    useEffect(() => {
        rtcConfigRef.current = rtcConfig;
    }, [rtcConfig]);

    const getSortedPeerIds = useCallback((): string[] => {
        return Array.from(peerConnectionsRef.current.keys()).sort((a, b) => a.localeCompare(b));
    }, []);

    const syncRemoteStreamsState = useCallback(() => {
        const sortedPeerIds = Array.from(remoteStreamsByPeerRef.current.keys()).sort((a, b) => a.localeCompare(b));
        const nextRemoteStreams: Record<string, MediaStream> = {};
        for (const peerCid of sortedPeerIds) {
            const stream = remoteStreamsByPeerRef.current.get(peerCid);
            if (stream) {
                nextRemoteStreams[peerCid] = stream;
            }
        }
        setRemoteStreams(nextRemoteStreams);
        setRemoteStream(sortedPeerIds.length > 0 ? nextRemoteStreams[sortedPeerIds[0]] ?? null : null);
    }, []);

    const getPrimaryPeerConnection = useCallback((): RTCPeerConnection | null => {
        const peerIds = getSortedPeerIds();
        if (peerIds.length === 0) {
            return null;
        }
        return peerConnectionsRef.current.get(peerIds[0]) ?? null;
    }, [getSortedPeerIds]);

    const refreshConnectionSnapshot = useCallback(() => {
        const primary = getPrimaryPeerConnection();
        if (!primary) {
            setIceConnectionState('new');
            setConnectionState('new');
            setSignalingState('stable');
            return;
        }

        setIceConnectionState(primary.iceConnectionState);
        setConnectionState(primary.connectionState);
        setSignalingState(primary.signalingState);
    }, [getPrimaryPeerConnection]);

    const clearRetryingTimer = useCallback(() => {
        if (retryingTimerRef.current !== null) {
            window.clearTimeout(retryingTimerRef.current);
            retryingTimerRef.current = null;
        }
    }, []);

    const setConnectionStatusValue = useCallback((nextStatus: ConnectionStatus) => {
        if (connectionStatusRef.current === nextStatus) {
            return;
        }
        connectionStatusRef.current = nextStatus;
        setConnectionStatus(nextStatus);
    }, []);

    const resetConnectionStatusMachine = useCallback(() => {
        clearRetryingTimer();
        setConnectionStatusValue('connected');
    }, [clearRetryingTimer, setConnectionStatusValue]);

    const isConnectionStatusMachineActive = useCallback((state: typeof roomStateRef.current = roomStateRef.current) => {
        return !!state && (state.participants?.length ?? 0) > 1;
    }, []);

    const scheduleRetryingTransition = useCallback(() => {
        if (retryingTimerRef.current !== null) {
            return;
        }
        retryingTimerRef.current = window.setTimeout(() => {
            retryingTimerRef.current = null;
            if (connectionStatusRef.current === 'recovering' && isConnectionStatusMachineActive()) {
                setConnectionStatusValue('retrying');
            }
        }, 10_000);
    }, [isConnectionStatusMachineActive, setConnectionStatusValue]);

    const setConnectionRecovering = useCallback((state: typeof roomStateRef.current = roomStateRef.current) => {
        if (!isConnectionStatusMachineActive(state)) {
            resetConnectionStatusMachine();
            return;
        }
        if (connectionStatusRef.current === 'connected') {
            setConnectionStatusValue('recovering');
        }
        if (connectionStatusRef.current !== 'retrying') {
            scheduleRetryingTransition();
        }
    }, [isConnectionStatusMachineActive, resetConnectionStatusMachine, scheduleRetryingTransition, setConnectionStatusValue]);

    const updateConnectionStatus = useCallback((state: typeof roomStateRef.current = roomStateRef.current) => {
        if (!isConnectionStatusMachineActive(state)) {
            resetConnectionStatusMachine();
            return;
        }

        if (!isConnectedRef.current) {
            setConnectionRecovering(state);
            return;
        }

        const peerConnections = Array.from(peerConnectionsRef.current.values());
        const hasDegradedPeer = peerConnections.some((pc) => (
            pc.iceConnectionState === 'disconnected' ||
            pc.iceConnectionState === 'failed' ||
            pc.connectionState === 'disconnected' ||
            pc.connectionState === 'failed'
        ));

        if (hasDegradedPeer) {
            setConnectionRecovering(state);
            return;
        }

        resetConnectionStatusMachine();
    }, [isConnectionStatusMachineActive, resetConnectionStatusMachine, setConnectionRecovering]);

    const refreshDiagnosticsAndStatus = useCallback(() => {
        refreshConnectionSnapshot();
        updateConnectionStatus();
    }, [refreshConnectionSnapshot, updateConnectionStatus]);

    const clearOfferTimeout = useCallback((peerCid: string) => {
        const timeoutId = offerTimeoutsRef.current.get(peerCid);
        if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            offerTimeoutsRef.current.delete(peerCid);
        }
    }, []);

    const clearAllOfferTimeouts = useCallback(() => {
        for (const timeoutId of offerTimeoutsRef.current.values()) {
            window.clearTimeout(timeoutId);
        }
        offerTimeoutsRef.current.clear();
    }, []);

    const shouldInitiateConnection = useCallback((peerCid: string): boolean => {
        const localCid = clientIdRef.current;
        if (!localCid) {
            return false;
        }
        // Deterministic initiator selection for mesh links to avoid dual-offer glare.
        return localCid.localeCompare(peerCid) < 0;
    }, []);

    const detectCameras = useCallback(async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(device => device.kind === 'videoinput');
            setHasMultipleCameras(cameras.length > 1);
        } catch (err) {
            console.warn('[WebRTC] Failed to enumerate devices', err);
        }
    }, []);

    useEffect(() => {
        setCanScreenShare(!!navigator.mediaDevices?.getDisplayMedia);
    }, []);

    useEffect(() => {
        detectCameras();
        navigator.mediaDevices?.addEventListener?.('devicechange', detectCameras);
        return () => {
            navigator.mediaDevices?.removeEventListener?.('devicechange', detectCameras);
        };
    }, [detectCameras]);

    const applySpeechTrackHints = useCallback((stream: MediaStream) => {
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) return;
        if ('contentHint' in audioTrack) {
            try {
                audioTrack.contentHint = 'speech';
            } catch (err) {
                console.warn('[WebRTC] Failed to set audio contentHint', err);
            }
        }
    }, []);

    const applyAudioSenderParameters = useCallback(async (pc: RTCPeerConnection) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (!sender || !sender.getParameters || !sender.setParameters) return;
        try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            if (params.encodings[0]) {
                params.encodings[0].maxBitrate = 32000;
            }
            await sender.setParameters(params);
        } catch (err) {
            console.warn('[WebRTC] Failed to apply audio sender parameters', err);
        }
    }, []);

    const replaceOrAddTrack = useCallback(async (pc: RTCPeerConnection, track: MediaStreamTrack, stream: MediaStream) => {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
        if (sender) {
            await sender.replaceTrack(track);
            return;
        }
        pc.addTrack(track, stream);
    }, []);

    const applyLocalTracksToAllPeers = useCallback(async (stream: MediaStream) => {
        const peerConnections = Array.from(peerConnectionsRef.current.values());
        if (peerConnections.length === 0) {
            return;
        }

        await Promise.allSettled(peerConnections.map(async (pc) => {
            const tracks = stream.getTracks();
            for (const track of tracks) {
                await replaceOrAddTrack(pc, track, stream);
            }
            await applyAudioSenderParameters(pc);
        }));
    }, [applyAudioSenderParameters, replaceOrAddTrack]);

    const replaceVideoTrackOnAllPeers = useCallback(async (track: MediaStreamTrack | null, streamForAdd?: MediaStream) => {
        const peerConnections = Array.from(peerConnectionsRef.current.values());
        await Promise.allSettled(peerConnections.map(async (pc) => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
                await sender.replaceTrack(track);
                return;
            }
            if (track && streamForAdd) {
                pc.addTrack(track, streamForAdd);
            }
        }));
    }, []);

    const removePeerConnection = useCallback((peerCid: string) => {
        clearOfferTimeout(peerCid);
        makingOfferPeersRef.current.delete(peerCid);
        pendingIceByPeerRef.current.delete(peerCid);

        const pc = peerConnectionsRef.current.get(peerCid);
        if (pc) {
            pc.ontrack = null;
            pc.onicecandidate = null;
            pc.oniceconnectionstatechange = null;
            pc.onconnectionstatechange = null;
            pc.onsignalingstatechange = null;
            pc.onnegotiationneeded = null;
            pc.close();
            peerConnectionsRef.current.delete(peerCid);
        }

        remoteStreamsByPeerRef.current.delete(peerCid);
        syncRemoteStreamsState();
        refreshDiagnosticsAndStatus();
    }, [clearOfferTimeout, refreshDiagnosticsAndStatus, syncRemoteStreamsState]);
    const removeAllPeerConnections = useCallback(() => {
        const peerIds = Array.from(peerConnectionsRef.current.keys());
        for (const peerCid of peerIds) {
            removePeerConnection(peerCid);
        }
        clearAllOfferTimeouts();
        pendingIceByPeerRef.current.clear();
        makingOfferPeersRef.current.clear();
        peerConnectionsRef.current.clear();
        remoteStreamsByPeerRef.current.clear();
        syncRemoteStreamsState();
        refreshDiagnosticsAndStatus();
    }, [clearAllOfferTimeouts, refreshDiagnosticsAndStatus, removePeerConnection, syncRemoteStreamsState]);

    const flushBufferedIce = useCallback(async (peerCid: string, pc: RTCPeerConnection) => {
        const buffered = pendingIceByPeerRef.current.get(peerCid);
        if (!buffered || buffered.length === 0) {
            return;
        }

        pendingIceByPeerRef.current.delete(peerCid);
        for (const candidate of buffered) {
            try {
                await pc.addIceCandidate(candidate);
            } catch (err) {
                console.warn('[WebRTC] Failed to apply buffered ICE candidate', err);
            }
        }
    }, []);

    const getOrCreatePeerConnection = useCallback((peerCid: string): RTCPeerConnection => {
        const existing = peerConnectionsRef.current.get(peerCid);
        if (existing) {
            return existing;
        }

        const pc = new RTCPeerConnection(rtcConfigRef.current);

        const stream = localStreamRef.current;
        if (stream) {
            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
            });
            void applyAudioSenderParameters(pc);
        }

        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                remoteStreamsByPeerRef.current.set(peerCid, event.streams[0]);
                syncRemoteStreamsState();
                return;
            }

            let streamByPeer = remoteStreamsByPeerRef.current.get(peerCid);
            if (!streamByPeer) {
                streamByPeer = new MediaStream();
                remoteStreamsByPeerRef.current.set(peerCid, streamByPeer);
            }
            if (!streamByPeer.getTracks().some(track => track.id === event.track.id)) {
                streamByPeer.addTrack(event.track);
            }
            syncRemoteStreamsState();
        };

        pc.onicecandidate = (event) => {
            if (!event.candidate) {
                return;
            }
            sendMessageRef.current('ice', { candidate: event.candidate }, peerCid);
        };

        pc.oniceconnectionstatechange = () => {
            refreshDiagnosticsAndStatus();
        };

        pc.onconnectionstatechange = () => {
            refreshDiagnosticsAndStatus();
            if (!isConnectedRef.current) {
                return;
            }

            if ((pc.connectionState === 'disconnected' || pc.connectionState === 'failed') && shouldInitiateConnection(peerCid)) {
                if (pc.signalingState === 'stable') {
                    void createOfferForPeerRef.current(peerCid, { iceRestart: true });
                }
            }
        };

        pc.onsignalingstatechange = () => {
            if (pc.signalingState === 'stable') {
                clearOfferTimeout(peerCid);
            }
            refreshDiagnosticsAndStatus();
        };

        pc.onnegotiationneeded = () => {
            if (!isConnectedRef.current) {
                return;
            }
            if (!shouldInitiateConnection(peerCid)) {
                return;
            }
            void createOfferForPeerRef.current(peerCid);
        };

        peerConnectionsRef.current.set(peerCid, pc);
        refreshDiagnosticsAndStatus();

        return pc;
    }, [applyAudioSenderParameters, clearOfferTimeout, refreshDiagnosticsAndStatus, shouldInitiateConnection, syncRemoteStreamsState]);

    const createOfferForPeer = useCallback(async (peerCid: string, options?: RTCOfferOptions) => {
        if (!isConnectedRef.current) {
            return;
        }

        const pc = getOrCreatePeerConnection(peerCid);
        if (makingOfferPeersRef.current.has(peerCid)) {
            return;
        }
        if (pc.signalingState !== 'stable') {
            return;
        }

        makingOfferPeersRef.current.add(peerCid);
        try {
            const offer = await pc.createOffer(options);
            await pc.setLocalDescription(offer as RTCSessionDescriptionInit);
            sendMessageRef.current('offer', { sdp: offer.sdp }, peerCid);

            clearOfferTimeout(peerCid);
            const timeoutId = window.setTimeout(() => {
                offerTimeoutsRef.current.delete(peerCid);
                const currentPc = peerConnectionsRef.current.get(peerCid);
                if (!currentPc) {
                    return;
                }
                if (currentPc.signalingState === 'have-local-offer') {
                    currentPc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit)
                        .catch((err) => {
                            console.warn('[WebRTC] Rollback failed after offer timeout', err);
                        })
                        .finally(() => {
                            if (shouldInitiateConnection(peerCid)) {
                                void createOfferForPeerRef.current(peerCid, { iceRestart: true });
                            }
                        });
                }
            }, OFFER_TIMEOUT_MS);
            offerTimeoutsRef.current.set(peerCid, timeoutId);
        } catch (err) {
            console.error('[WebRTC] Failed to create offer for peer', peerCid, err);
        } finally {
            makingOfferPeersRef.current.delete(peerCid);
        }
    }, [clearOfferTimeout, getOrCreatePeerConnection, shouldInitiateConnection]);

    useEffect(() => {
        createOfferForPeerRef.current = createOfferForPeer;
    }, [createOfferForPeer]);

    const handleOffer = useCallback(async (fromCid: string, sdp: string) => {
        const pc = getOrCreatePeerConnection(fromCid);

        clearOfferTimeout(fromCid);

        try {
            if (pc.signalingState === 'have-local-offer') {
                if (shouldInitiateConnection(fromCid)) {
                    // Deterministic initiator rule: keep local offer if this side owns negotiation for this pair.
                    return;
                }
                await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
            }

            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
            await flushBufferedIce(fromCid, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer as RTCSessionDescriptionInit);
            sendMessageRef.current('answer', { sdp: answer.sdp }, fromCid);
        } catch (err) {
            console.error('[WebRTC] Failed to handle offer', err);
        }
    }, [clearOfferTimeout, flushBufferedIce, getOrCreatePeerConnection, shouldInitiateConnection]);

    const handleAnswer = useCallback(async (fromCid: string, sdp: string) => {
        const pc = peerConnectionsRef.current.get(fromCid);
        if (!pc) {
            return;
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
            clearOfferTimeout(fromCid);
            await flushBufferedIce(fromCid, pc);
        } catch (err) {
            console.error('[WebRTC] Failed to handle answer', err);
        }
    }, [clearOfferTimeout, flushBufferedIce]);

    const handleIce = useCallback(async (fromCid: string, candidate: RTCIceCandidateInit) => {
        const pc = getOrCreatePeerConnection(fromCid);
        if (pc.remoteDescription) {
            try {
                await pc.addIceCandidate(candidate);
            } catch (err) {
                console.error('[WebRTC] Failed to add ICE candidate', err);
            }
            return;
        }

        const existing = pendingIceByPeerRef.current.get(fromCid) ?? [];
        if (existing.length >= ICE_CANDIDATE_BUFFER_MAX) {
            existing.shift();
        }
        existing.push(candidate);
        pendingIceByPeerRef.current.set(fromCid, existing);
    }, [getOrCreatePeerConnection]);

    const processSignalingMessage = useCallback(async (msg: any) => {
        const { type, payload } = msg;

        const fromCid = typeof payload?.from === 'string' ? payload.from : null;
        if ((type === 'offer' || type === 'answer' || type === 'ice') && !fromCid) {
            console.warn('[WebRTC] Ignoring signaling message without payload.from', msg);
            return;
        }

        switch (type) {
            case 'offer':
                if (fromCid && typeof payload?.sdp === 'string') {
                    await handleOffer(fromCid, payload.sdp);
                }
                break;
            case 'answer':
                if (fromCid && typeof payload?.sdp === 'string') {
                    await handleAnswer(fromCid, payload.sdp);
                }
                break;
            case 'ice':
                if (fromCid && payload?.candidate) {
                    await handleIce(fromCid, payload.candidate as RTCIceCandidateInit);
                }
                break;
            default:
                break;
        }
    }, [handleAnswer, handleIce, handleOffer]);

    useEffect(() => {
        const unsubscribe = subscribeToMessages((msg) => {
            void processSignalingMessage(msg);
        });
        return () => {
            unsubscribe();
        };
    }, [processSignalingMessage, subscribeToMessages]);

    useEffect(() => {
        const state = roomState;
        const localCid = clientId;

        if (!state || !localCid) {
            if (peerConnectionsRef.current.size > 0) {
                removeAllPeerConnections();
            } else {
                syncRemoteStreamsState();
                refreshDiagnosticsAndStatus();
            }
            return;
        }

        const expectedPeerIds = new Set(
            state.participants
                .map(participant => participant.cid)
                .filter(cid => cid !== localCid)
        );

        for (const existingPeerCid of Array.from(peerConnectionsRef.current.keys())) {
            if (!expectedPeerIds.has(existingPeerCid)) {
                removePeerConnection(existingPeerCid);
            }
        }

        for (const peerCid of expectedPeerIds) {
            const pc = getOrCreatePeerConnection(peerCid);
            if (
                shouldInitiateConnection(peerCid) &&
                isConnectedRef.current &&
                pc.signalingState === 'stable' &&
                !pc.remoteDescription
            ) {
                void createOfferForPeerRef.current(peerCid);
            }
        }

        refreshDiagnosticsAndStatus();
    }, [clientId, getOrCreatePeerConnection, refreshDiagnosticsAndStatus, removeAllPeerConnections, removePeerConnection, roomState, shouldInitiateConnection, syncRemoteStreamsState]);

    useEffect(() => {
        updateConnectionStatus(roomState);
    }, [isConnected, roomState, updateConnectionStatus]);

    // Keep opportunistic ICE restart on network transitions for active mesh links.
    useEffect(() => {
        const requestMeshIceRestart = () => {
            for (const peerCid of peerConnectionsRef.current.keys()) {
                if (!shouldInitiateConnection(peerCid)) {
                    continue;
                }
                const pc = peerConnectionsRef.current.get(peerCid);
                if (!pc || pc.signalingState !== 'stable') {
                    continue;
                }
                void createOfferForPeerRef.current(peerCid, { iceRestart: true });
            }
        };

        const handleOnline = () => {
            requestMeshIceRestart();
        };

        const handleNetworkChange = () => {
            requestMeshIceRestart();
        };

        window.addEventListener('online', handleOnline);
        const conn = (navigator as any).connection;
        conn?.addEventListener?.('change', handleNetworkChange);
        return () => {
            window.removeEventListener('online', handleOnline);
            conn?.removeEventListener?.('change', handleNetworkChange);
        };
    }, [shouldInitiateConnection]);

    // Ensure media + peer resources are stopped when provider unmounts.
    useEffect(() => {
        return () => {
            unmountedRef.current = true;
            clearRetryingTimer();
            clearAllOfferTimeouts();
            removeAllPeerConnections();

            const stream = localStreamRef.current;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [clearAllOfferTimeouts, clearRetryingTimer, removeAllPeerConnections]);
    // Fetch ICE servers when TURN token is available (non-blocking: default STUN already set).
    useEffect(() => {
        if (!turnToken) {
            return;
        }
        const controller = new AbortController();
        const fetchIceServers = async () => {
            try {
                let apiUrl = '/api/turn-credentials';
                const wsUrl = import.meta.env.VITE_WS_URL;
                if (wsUrl) {
                    const url = new URL(wsUrl);
                    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
                    url.pathname = '/api/turn-credentials';
                    url.searchParams.set('token', turnToken);
                    apiUrl = url.toString();
                } else {
                    apiUrl = `/api/turn-credentials?token=${encodeURIComponent(turnToken)}`;
                }

                const timeoutId = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);
                const res = await fetch(apiUrl, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const params = new URLSearchParams(window.location.search);
                    const turnsOnly = params.get('turnsonly') === '1';

                    const servers: RTCIceServer[] = [];
                    if (data.uris) {
                        let uris = data.uris as string[];
                        if (turnsOnly) {
                            uris = uris.filter((uri: string) => uri.startsWith('turns:'));
                        }

                        if (uris.length > 0) {
                            servers.push({
                                urls: uris,
                                username: data.username,
                                credential: data.password
                            });
                        }
                    }

                    const config: RTCConfiguration = {
                        iceServers: servers.length > 0 ? servers : DEFAULT_RTC_CONFIG.iceServers
                    };

                    if (turnsOnly) {
                        config.iceTransportPolicy = 'relay';
                    }

                    setRtcConfig(config);
                } else {
                    console.warn('[WebRTC] Failed to fetch ICE servers, keeping default STUN');
                }
            } catch (err) {
                if (controller.signal.aborted) {
                    console.warn('[WebRTC] TURN fetch timed out, keeping default STUN');
                } else {
                    console.error('[WebRTC] Error fetching ICE servers:', err);
                }
            }
        };

        void fetchIceServers();
        return () => controller.abort();
    }, [turnToken]);

    const startLocalMedia = useCallback(async (): Promise<MediaStream | null> => {
        const requestId = mediaRequestIdRef.current + 1;
        mediaRequestIdRef.current = requestId;

        if (localStreamRef.current) {
            return localStreamRef.current;
        }

        requestingMediaRef.current = true;
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                showToast('error', t('toast_media_blocked'));
                requestingMediaRef.current = false;
                return null;
            }

            const audioConstraints: MediaTrackConstraints = {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true },
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 }
            };

            let stream: MediaStream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facingModeRef.current },
                    audio: audioConstraints
                });
            } catch (constraintErr) {
                console.warn('[WebRTC] getUserMedia failed with constraints, retrying with relaxed', constraintErr);
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            }

            if (unmountedRef.current || mediaRequestIdRef.current !== requestId) {
                stream.getTracks().forEach(track => track.stop());
                requestingMediaRef.current = false;
                return null;
            }

            applySpeechTrackHints(stream);
            setLocalStream(stream);
            await detectCameras();
            await applyLocalTracksToAllPeers(stream);

            requestingMediaRef.current = false;
            return stream;
        } catch (err) {
            console.error('Error accessing media', err);
            requestingMediaRef.current = false;
            return null;
        }
    }, [applyLocalTracksToAllPeers, applySpeechTrackHints, detectCameras, showToast, t]);

    const stopLocalMedia = useCallback(() => {
        mediaRequestIdRef.current += 1;

        const screenShareTrack = screenShareTrackRef.current;
        if (screenShareTrack) {
            screenShareTrack.onended = null;
            screenShareTrackRef.current = null;
        }

        const stream = localStreamRef.current;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setLocalStream(null);
        }

        setIsScreenSharing(false);
        setFacingMode('user');
        requestingMediaRef.current = false;
    }, []);

    const stopScreenShare = useCallback(async () => {
        if (!isScreenSharingRef.current) {
            return;
        }

        const currentStream = localStreamRef.current;
        if (!currentStream) {
            setIsScreenSharing(false);
            return;
        }

        const screenShareTrack = screenShareTrackRef.current;
        if (screenShareTrack) {
            screenShareTrack.onended = null;
            screenShareTrackRef.current = null;
        }

        const previousVideoTrack = currentStream.getVideoTracks()[0];
        const wasVideoEnabled = previousVideoTrack ? previousVideoTrack.enabled : true;

        try {
            const cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: facingModeRef.current },
                audio: false
            });
            const cameraTrack = cameraStream.getVideoTracks()[0];
            if (!cameraTrack) {
                throw new Error('No camera track returned');
            }
            cameraTrack.enabled = wasVideoEnabled;

            await replaceVideoTrackOnAllPeers(cameraTrack, currentStream);

            setLocalStream(new MediaStream([
                cameraTrack,
                ...currentStream.getAudioTracks()
            ]));
            if (previousVideoTrack) {
                previousVideoTrack.stop();
            }
            setIsScreenSharing(false);
        } catch (err) {
            console.error('[WebRTC] Failed to stop screen share and restore camera', err);
            await replaceVideoTrackOnAllPeers(null);
            if (previousVideoTrack) {
                previousVideoTrack.stop();
            }
            setLocalStream(new MediaStream([
                ...currentStream.getAudioTracks()
            ]));
            setIsScreenSharing(false);
            showToast('error', t('toast_camera_error'));
        }
    }, [replaceVideoTrackOnAllPeers, showToast, t]);

    const startScreenShare = useCallback(async () => {
        if (isScreenSharingRef.current || !canScreenShare) {
            return;
        }

        const currentStream = localStreamRef.current;
        if (!currentStream) {
            return;
        }

        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });
            const displayTrack = displayStream.getVideoTracks()[0];
            if (!displayTrack) {
                displayStream.getTracks().forEach(track => track.stop());
                throw new Error('No display track returned');
            }

            const previousVideoTrack = currentStream.getVideoTracks()[0];
            const wasVideoEnabled = previousVideoTrack ? previousVideoTrack.enabled : true;
            displayTrack.enabled = wasVideoEnabled;
            if ('contentHint' in displayTrack) {
                try {
                    displayTrack.contentHint = 'detail';
                } catch (err) {
                    console.warn('[WebRTC] Failed to set display track contentHint', err);
                }
            }

            await replaceVideoTrackOnAllPeers(displayTrack, currentStream);

            if (screenShareTrackRef.current) {
                screenShareTrackRef.current.onended = null;
            }
            screenShareTrackRef.current = displayTrack;
            displayTrack.onended = () => {
                void stopScreenShare();
            };

            setLocalStream(new MediaStream([
                displayTrack,
                ...currentStream.getAudioTracks()
            ]));
            if (previousVideoTrack) {
                previousVideoTrack.stop();
            }
            setIsScreenSharing(true);
        } catch (err) {
            console.error('[WebRTC] Failed to start screen share', err);
            showToast('error', t('toast_screen_share_error'));
        }
    }, [canScreenShare, replaceVideoTrackOnAllPeers, showToast, stopScreenShare, t]);

    const flipCamera = useCallback(async () => {
        if (isScreenSharingRef.current) return;
        if (!hasMultipleCameras) return;

        const newMode = facingModeRef.current === 'user' ? 'environment' : 'user';
        setFacingMode(newMode);

        const currentStream = localStreamRef.current;
        if (!currentStream) return;

        try {
            const oldVideoTrack = currentStream.getVideoTracks()[0];
            if (oldVideoTrack) {
                oldVideoTrack.stop();
            }

            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: newMode },
                audio: false
            });

            const newVideoTrack = newStream.getVideoTracks()[0];
            if (!newVideoTrack) {
                throw new Error('No video track returned while flipping camera');
            }

            await replaceVideoTrackOnAllPeers(newVideoTrack, currentStream);

            const combinedStream = new MediaStream([
                newVideoTrack,
                ...currentStream.getAudioTracks()
            ]);
            setLocalStream(combinedStream);
        } catch (err) {
            console.error('[WebRTC] Failed to flip camera', err);
            showToast('error', t('toast_flip_camera_error'));
        }
    }, [hasMultipleCameras, replaceVideoTrackOnAllPeers, showToast, t]);

    return (
        <WebRTCContext.Provider value={{
            localStream,
            remoteStream,
            remoteStreams,
            startLocalMedia,
            stopLocalMedia,
            startScreenShare,
            stopScreenShare,
            isScreenSharing,
            canScreenShare,
            flipCamera,
            facingMode,
            hasMultipleCameras,
            peerConnection: getPrimaryPeerConnection(),
            iceConnectionState,
            connectionState,
            signalingState,
            connectionStatus
        }}>
            {children}
        </WebRTCContext.Provider>
    );
};

