import { useCallback } from 'react';

/**
 * Stable host for Beyond / LiveKit avatar video: one container + children overlays.
 * Isolated so parent re-renders (transcript, agent state) do not recreate this DOM subtree.
 * The actual <video> for avatar tracks is ensured once in VideoInterviewCall (single element via ref).
 */
const AVATAR_HOST_STYLE = {
    gridColumn: '1',
    aspectRatio: '16/9',
    background: 'rgba(15, 23, 42, 0.8)',
    border: '2px solid rgba(34, 211, 238, 0.3)',
    borderRadius: '20px',
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    minWidth: '400px',
    minHeight: '400px',
    maxHeight: '800px',
    display: 'block',
    visibility: 'visible',
    opacity: 1,
    zIndex: 1,
    flexShrink: 0,
    flexGrow: 1,
    boxSizing: 'border-box',
    margin: '0 auto',
};

export function AvatarHostContainer({ children, onContainerNode }) {
    const setRef = useCallback(
        (el) => {
            onContainerNode?.(el);
        },
        [onContainerNode]
    );

    return (
        <div ref={setRef} key="avatar-container-stable" style={AVATAR_HOST_STYLE}>
            {children}
        </div>
    );
}
