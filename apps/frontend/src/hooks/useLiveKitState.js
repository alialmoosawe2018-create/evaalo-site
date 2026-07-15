/**
 * LiveKit State Synchronization Hook
 * يدير state synchronization و RPC بين Frontend و Agent
 * ✅ يتبع وثائق LiveKit: https://docs.livekit.io/frontends/build/agent-state/
 * - lk.agent.state من participant attributes
 * - ParticipantAttributesChanged للحدث الفوري (بدون polling)
 * - AgentSession = participant بـ kind AGENT وبدون lk.publish_on_behalf
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { DataPacket_Kind, RoomEvent, ParticipantKind } from 'livekit-client';

const AGENT_STATE_ATTR = 'lk.agent.state';
const PUBLISH_ON_BEHALF_ATTR = 'lk.publish_on_behalf';

/** AgentSession participant (ليس avatar worker) - كما في useAgent من @livekit/components-react */
const getAgentSessionParticipant = (room) => {
    if (!room) return null;
    const participants = Array.from(room.remoteParticipants.values());
    const agentSession = participants.find(p => {
        if (p.kind !== ParticipantKind.AGENT) return false;
        const attrs = p.attributes ?? {};
        const hasPublishOnBehalf = typeof attrs === 'object' && PUBLISH_ON_BEHALF_ATTR in attrs;
        return !hasPublishOnBehalf; // AgentSession ليس له PublishOnBehalf
    });
    return agentSession || participants.find(p => p.identity?.startsWith('agent-')) || participants.find(p => p.identity === 'bey-avatar-agent') || null;
};

/**
 * من يملك lk.agent.state الموثوق؟ نقرأ فقط من وكيل الجلسة (AgentSession): انتهاء جولة الرد من خط LLM/TTS.
 * لا نستخدم bey-avatar-agent — لديه نفس المفتاح لكنه يتبع مسار الفيديو/التشغيل وليس «انتهى الرد» دلالياً.
 */
/** يشمل القيمة الفارغة — إلا نُسقِط المشارك من القائمة فيبقى الواجهة على speaking قديماً */
const hasUsableAgentState = (p) => {
    const v = p?.attributes?.[AGENT_STATE_ATTR];
    return v !== undefined && v !== null;
};

/** يُستبعد من مصدر `lk.agent.state` — عامل الأفاتار؛ الحالة المرئية للحركة لا تُقياس لانتهاء الكلام. */
const isSessionAgentStateSource = (p) => p && p.identity !== 'bey-avatar-agent';

const getAgentStateParticipant = (room) => {
    if (!room) return null;
    const participants = Array.from(room.remoteParticipants.values());
    const withState = participants.filter(
        (p) => hasUsableAgentState(p) && isSessionAgentStateSource(p)
    );
    if (withState.length === 0) return null;

    const rank = (p) => {
        const attrs = p.attributes ?? {};
        const hasPob = typeof attrs === 'object' && PUBLISH_ON_BEHALF_ATTR in attrs;
        if (p.kind === ParticipantKind.AGENT && !hasPob) return 100;
        if (p.identity?.startsWith('agent-')) return 80;
        return 50;
    };

    let best = withState[0];
    let bestR = rank(best);
    for (let i = 1; i < withState.length; i += 1) {
        const p = withState[i];
        const r = rank(p);
        if (r > bestR) {
            best = p;
            bestR = r;
        }
    }
    return best;
};

const useLiveKitState = (room) => {
    const [agentState, setAgentState] = useState(null);
    const [customState, setCustomState] = useState({});
    const [rpcMethods, setRpcMethods] = useState({});
    const stateListenersRef = useRef(new Set());

    // Subscribe to agent state - حسب وثائق LiveKit (event-driven فقط)
    useEffect(() => {
        if (!room) return;

        const readStateFromParticipant = (participant) => {
            if (!participant) return null;
            const attrs = participant.attributes ?? {};
            return attrs[AGENT_STATE_ATTR] ?? null;
        };

        /** سلسلة فارغة من السيرفر = اعتبر listening (لا تترك speaking عالقاً) */
        const normalizeAgentStateAttr = (raw) => {
            if (raw === undefined || raw === null) return null;
            const s = String(raw).trim();
            if (s === '') return 'listening';
            return s;
        };

        const updateAgentState = () => {
            if (room.state === 'disconnected') {
                setAgentState(null);
                return;
            }
            let authoritative = getAgentStateParticipant(room);
            if (!authoritative) {
                const fallback = getAgentSessionParticipant(room);
                if (isSessionAgentStateSource(fallback)) {
                    authoritative = fallback;
                }
            }
            if (!authoritative) {
                setAgentState(null);
                return;
            }
            const raw = readStateFromParticipant(authoritative);
            setAgentState(normalizeAgentStateAttr(raw));
        };

        updateAgentState();

        const onRoomDisconnected = () => {
            setAgentState(null);
        };

        // أعد قراءة الحالة عند أي تغيير لصفات أي مشارك — بعض إصدارات SDK لا تُدرج lk.agent.state في changedAttributes فقط
        const handleAttributesChanged = (_changedAttributes, _participant) => {
            updateAgentState();
        };
        room.on(RoomEvent.ParticipantAttributesChanged, handleAttributesChanged);
        room.on(RoomEvent.ParticipantConnected, updateAgentState);
        room.on(RoomEvent.ParticipantDisconnected, updateAgentState);
        room.on(RoomEvent.Disconnected, onRoomDisconnected);

        return () => {
            room.off(RoomEvent.ParticipantAttributesChanged, handleAttributesChanged);
            room.off(RoomEvent.ParticipantConnected, updateAgentState);
            room.off(RoomEvent.ParticipantDisconnected, updateAgentState);
            room.off(RoomEvent.Disconnected, onRoomDisconnected);
        };
    }, [room]);

    // Send custom state to agent
    const sendState = useCallback(async (key, value) => {
        if (!room) {
            console.warn('Room not available for state sync');
            return false;
        }

        try {
            const stateData = {
                type: 'state_update',
                key,
                value,
                timestamp: Date.now()
            };

            const data = new TextEncoder().encode(JSON.stringify(stateData));
            
            await room.localParticipant.publishData(
                data,
                DataPacket_Kind.RELIABLE,
                ['state']
            );

            // Update local state
            setCustomState(prev => ({
                ...prev,
                [key]: value
            }));

            console.log('✅ State sent to agent:', key, value);
            return true;
        } catch (error) {
            console.error('Error sending state:', error);
            return false;
        }
    }, [room]);

    // Listen for state updates from agent
    useEffect(() => {
        if (!room) return;

        const handleDataReceived = (payload, participant, kind, topic) => {
            if (topic && topic.includes('state')) {
                try {
                    const data = typeof payload === 'string' 
                        ? JSON.parse(payload) 
                        : JSON.parse(new TextDecoder().decode(payload));

                    if (data.type === 'state_update') {
                        setCustomState(prev => ({
                            ...prev,
                            [data.key]: data.value
                        }));

                        // Notify listeners
                        stateListenersRef.current.forEach(listener => {
                            listener(data.key, data.value);
                        });
                    }
                } catch (e) {
                    console.warn('Error parsing state data:', e);
                }
            }
        };

        room.on('dataReceived', handleDataReceived);

        return () => {
            room.off('dataReceived', handleDataReceived);
        };
    }, [room]);

    // Register RPC method
    const registerRPCMethod = useCallback((methodName, handler) => {
        setRpcMethods(prev => ({
            ...prev,
            [methodName]: handler
        }));
    }, []);

    // Call RPC method on agent
    const callRPC = useCallback(async (methodName, params = {}) => {
        if (!room) {
            console.warn('Room not available for RPC');
            return null;
        }

        try {
            const rpcData = {
                type: 'rpc_call',
                method: methodName,
                params,
                timestamp: Date.now(),
                requestId: `rpc_${Date.now()}_${Math.random()}`
            };

            const data = new TextEncoder().encode(JSON.stringify(rpcData));
            
            await room.localParticipant.publishData(
                data,
                DataPacket_Kind.RELIABLE,
                ['rpc']
            );

            console.log('✅ RPC call sent:', methodName, params);
            
            // Return a promise that resolves when response is received
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('RPC timeout'));
                }, 10000); // 10 second timeout

                const handleResponse = (payload, participant, kind, topic) => {
                    if (topic && topic.includes('rpc_response')) {
                        try {
                            const response = typeof payload === 'string' 
                                ? JSON.parse(payload) 
                                : JSON.parse(new TextDecoder().decode(payload));

                            if (response.requestId === rpcData.requestId) {
                                clearTimeout(timeout);
                                room.off('dataReceived', handleResponse);
                                
                                if (response.error) {
                                    reject(new Error(response.error));
                                } else {
                                    resolve(response.result);
                                }
                            }
                        } catch (e) {
                            console.warn('Error parsing RPC response:', e);
                        }
                    }
                };

                room.on('dataReceived', handleResponse);
            });
        } catch (error) {
            console.error('Error calling RPC:', error);
            throw error;
        }
    }, [room]);

    // Handle RPC calls from agent
    useEffect(() => {
        if (!room) return;

        const handleRPC = async (payload, participant, kind, topic) => {
            if (topic && topic.includes('rpc_call')) {
                try {
                    const rpcData = typeof payload === 'string' 
                        ? JSON.parse(payload) 
                        : JSON.parse(new TextDecoder().decode(payload));

                    if (rpcData.type === 'rpc_call' && rpcMethods[rpcData.method]) {
                        const handler = rpcMethods[rpcData.method];
                        const result = await handler(rpcData.params);

                        // Send response
                        const response = {
                            type: 'rpc_response',
                            requestId: rpcData.requestId,
                            result,
                            timestamp: Date.now()
                        };

                        const data = new TextEncoder().encode(JSON.stringify(response));
                        await room.localParticipant.publishData(
                            data,
                            DataPacket_Kind.RELIABLE,
                            ['rpc_response']
                        );
                    }
                } catch (e) {
                    console.warn('Error handling RPC:', e);
                }
            }
        };

        room.on('dataReceived', handleRPC);

        return () => {
            room.off('dataReceived', handleRPC);
        };
    }, [room, rpcMethods]);

    // Subscribe to state changes
    const subscribeToState = useCallback((listener) => {
        stateListenersRef.current.add(listener);
        return () => {
            stateListenersRef.current.delete(listener);
        };
    }, []);

    return {
        agentState,
        customState,
        sendState,
        callRPC,
        registerRPCMethod,
        subscribeToState
    };
};

export default useLiveKitState;
