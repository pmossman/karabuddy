// contexts/GameContext.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// TODO(karabuddy): re-enable when replay-driver is wired up.
// Original at ~/code/karabast-dev/forceteki-client/src/app/_contexts/Game.context.tsx
// We stripped socket.io + lobby + sound + popup-handling wiring because the
// karabuddy renderer is read-only and consumes pre-recorded gamestate
// snapshots. The shape of `gameState` and the public API are preserved so
// child components compile unchanged; `setGameState` is exposed so a
// replay driver (e.g. /test-board, /r/[slug]) can push frames directly.
'use client';
import React, {
    createContext,
    useContext,
    useState,
    ReactNode,
} from 'react';
import { IDistributionPromptData } from '@/app/_hooks/useDistributionPrompt';
import { IStatsNotification } from '@/app/_components/_sharedcomponents/Preferences/Preferences.types';
import { IChatEntry } from '@/app/_components/_sharedcomponents/Chat/ChatTypes';

// Socket type was imported from socket.io-client; we shim it as a structural
// type so createNewSocket can return a no-op object without dragging the dep.
type SocketLike = { disconnect: () => void; emit: (...args: any[]) => void };

interface IGameContextType {
    gameState: any;
    setGameState: (gs: any) => void;
    gameMessages: IChatEntry[];
    lobbyState: any;
    setLobbyState: (ls: any) => void;
    bugReportState: any;
    playerReportState: any;
    statsSubmitNotification: IStatsNotification | null;
    sendMessage: (message: string, args?: any[]) => void;
    sendGameMessage: (args: any[]) => void;
    getOpponent: (player: string) => string;
    connectedPlayer: string;
    setConnectedPlayer: (id: string) => void;
    sendLobbyMessage: (args: any[]) => void;
    resetStates: () => void;
    getConnectedPlayerPrompt: () => any;
    updateDistributionPrompt: (uuid: string, amount: number) => void;
    distributionPromptData: IDistributionPromptData | null;
    isSpectator: boolean;
    lastQueueHeartbeat: number;
    isAnonymousPlayer: (player: string) => boolean;
    hasChatDisabled: (player: string) => boolean;
    createNewSocket: () => SocketLike | undefined;
    gameIsEnded: () => boolean;
    hoveredChatCard: {
        id: string | null;
        hover: (id: string) => void;
        clear: () => void;
    };
}

const GameContext = createContext<IGameContextType | undefined>(undefined);

export const GameProvider = ({ children }: { children: ReactNode }) => {
    const [gameState, setGameState] = useState<any>(null);
    const [lobbyState, setLobbyState] = useState<any>(null);
    const [bugReportState] = useState<any>(null);
    const [playerReportState] = useState<any>(null);
    const [statsSubmitNotification] = useState<IStatsNotification | null>(null);
    const [lastQueueHeartbeat] = useState(Date.now());
    const [connectedPlayer, setConnectedPlayer] = useState<string>('');
    const [hoveredChatCardId, setHoveredCardId] = useState<string | null>(null);
    const [isSpectator] = useState<boolean>(false);

    // Static for now — a replay driver would push fresh game messages.
    const gameMessages: IChatEntry[] = [];
    const distributionPromptData: IDistributionPromptData | null = null;

    const createNewSocket = (): SocketLike | undefined => undefined;

    const sendMessage = (_message: string, _args: any[] = []) => {
        // no-op: read-only replay viewer
    };

    const sendGameMessage = (_args: any[]) => {
        // no-op
    };

    const sendLobbyMessage = (_args: any[]) => {
        // no-op
    };

    const getOpponent = (player: string) => {
        if (gameState) {
            const playerNames = Object.keys(gameState.players);
            return playerNames.find((name) => name !== player) || '';
        }
        if (lobbyState) {
            return lobbyState.users.find((p: any) => p.id !== player)?.id || '';
        }
        return '';
    };

    const isAnonymousPlayer = (player: string): boolean => {
        if (lobbyState) {
            return lobbyState.users.find((p: any) => p.id === player)?.authenticated === false;
        }
        return true;
    };

    const hasChatDisabled = (player: string): boolean => {
        if (lobbyState) {
            return !!lobbyState.users.find((p: any) => p.id === player)?.chatDisabled;
        }
        return false;
    };

    const resetStates = () => {
        setLobbyState(null);
        setGameState(null);
    };

    const getConnectedPlayerPrompt = () => {
        if (!gameState) return '';
        return gameState.players[connectedPlayer]?.promptState;
    };

    const updateDistributionPrompt = (_uuid: string, _amount: number) => {
        // no-op
    };

    const gameIsEnded = () => !!gameState?.winners?.length;

    return (
        <GameContext.Provider
            value={{
                gameState,
                setGameState,
                gameMessages,
                lobbyState,
                setLobbyState,
                bugReportState,
                playerReportState,
                statsSubmitNotification,
                sendGameMessage,
                sendMessage,
                connectedPlayer,
                setConnectedPlayer,
                getOpponent,
                sendLobbyMessage,
                resetStates,
                getConnectedPlayerPrompt,
                updateDistributionPrompt,
                distributionPromptData,
                isSpectator,
                lastQueueHeartbeat,
                isAnonymousPlayer,
                hasChatDisabled,
                createNewSocket,
                gameIsEnded,
                hoveredChatCard: {
                    id: hoveredChatCardId,
                    hover: setHoveredCardId,
                    clear: () => setHoveredCardId(null)
                }
            }}
        >
            {children}
        </GameContext.Provider>
    );
};

export const useGame = () => {
    const context = useContext(GameContext);
    if (!context) {
        throw new Error('useGame must be used within a GameProvider');
    }
    return context;
};
