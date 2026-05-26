// Smoke-test route for the lifted forceteki renderer.
// Confirms the Gameboard component tree mounts inside karabuddy with a
// hand-rolled stub gamestate. Replace the stub with a real replay frame
// once the replay-driver is wired up.
'use client';

import React, { useEffect } from 'react';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider, useGame } from '@/app/_contexts/Game.context';
import Gameboard from '@/app/_components/Gameboard/Gameboard';

const PLAYER_ID = 'player-one';
const OPPONENT_ID = 'player-two';

// Minimal gamestate that satisfies every `gameState.*` access we found in
// the Gameboard tree. All zones are empty; no prompts. The renderer should
// mount and show a recognisable but empty board.
function buildStubGameState() {
    const emptyPlayer = (id: string, username: string) => ({
        user: { id, username, cosmetics: {} },
        leader: { uuid: `${id}-leader`, id: '', setId: { set: '', number: 0 }, type: 'leader', types: ['leader'] },
        base: { uuid: `${id}-base`, id: '', setId: { set: '', number: 0 }, type: 'base', types: ['base'] },
        hasInitiative: id === PLAYER_ID,
        isActionPhaseActivePlayer: id === PLAYER_ID,
        availableResources: 0,
        numCardsInDeck: 0,
        topCardOfDeck: null,
        timerIsRunning: false,
        turnTimeRemainingSeconds: 0,
        mainTimeRemainingSeconds: 0,
        availableSnapshots: { quickSnapshotAvailable: null },
        promptState: {
            buttons: [],
            menuTitle: '',
            promptTitle: '',
            promptUuid: '',
            selectCardMode: false,
            promptType: 'actionWindow',
            dropdownListOptions: [],
            perCardButtons: [],
            displayCards: [],
            playerIsNewlyActive: false,
            distributeAmongTargets: null,
        },
        cardPiles: {
            hand: [],
            resources: [],
            discard: [],
            deck: [],
            credits: [],
            capturedZone: [],
            groundArena: [],
            spaceArena: [],
        },
    });

    return {
        id: 'stub-game',
        phase: 'action',
        initiativeClaimed: false,
        winners: [],
        clientUIProperties: {},
        players: {
            [PLAYER_ID]: emptyPlayer(PLAYER_ID, 'Player One'),
            [OPPONENT_ID]: emptyPlayer(OPPONENT_ID, 'Player Two'),
        },
        spectators: {},
    };
}

const BoardDriver: React.FC = () => {
    const { setGameState, setConnectedPlayer } = useGame();
    useEffect(() => {
        setConnectedPlayer(PLAYER_ID);
        setGameState(buildStubGameState());
    }, [setGameState, setConnectedPlayer]);
    return <Gameboard />;
};

export default function TestBoardPage() {
    return (
        <ThemeContextProvider>
            <UserProvider>
                <CosmeticsProvider>
                    <PopupProvider>
                        <GameProvider>
                            <BoardDriver />
                        </GameProvider>
                    </PopupProvider>
                </CosmeticsProvider>
            </UserProvider>
        </ThemeContextProvider>
    );
}
